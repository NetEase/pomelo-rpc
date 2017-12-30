var util = require('util');
var utils = require('../../util/utils');
var WebSocket = require('ws');
var Tracer = require('../../util/tracer');
var constants = require('../../util/constants');
var EventEmitter = require('events').EventEmitter;
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);

var MailBox = function(server, opts) {
  EventEmitter.call(this);
  this.curId = 0;
  this.id = server.id;
  this.host = server.host;
  this.port = server.port;
  this.requests = {};
  this.timeout = {};
  this.queue = [];
  this.bufferMsg = opts.bufferMsg;
  this.interval = opts.interval || constants.DEFAULT_PARAM.INTERVAL;
  this.timeoutValue = opts.timeout || constants.DEFAULT_PARAM.CALLBACK_TIMEOUT;
  this.connected = false;
  this.connecting = false;
  this.opts = opts;

  // Heartbeat ping interval.
  this.ping = 'ping' in opts ? opts.ping : 25e3;

  // Heartbeat pong response timeout.
  this.pong = 'pong' in opts ? opts.pong : 10e3;

  this.timer = {};
};
util.inherits(MailBox, EventEmitter);

var  pro = MailBox.prototype;

pro.connect = function(tracer, cb) {
  tracer.info('client', __filename, 'connect', 'ws-mailbox try to connect');
  if(this.connected) {
    tracer.error('client', __filename, 'connect', 'mailbox has already connected');
    utils.invokeCallback(cb, new Error('mailbox has already connected.'));
    return;
  }
  var self = this;

  if(this.connecting) {
    utils.invokeCallback(cb, new Error('mailbox is connecting now.'));
    return;
  }
  // set status connecting now  
  this.connecting = true;

  this.socket = new WebSocket('ws://' + this.host + ':' + this.port);
  this.socket.on('message', function(pkg) {
    try {
      pkg = JSON.parse(pkg);

      if(pkg instanceof Array) {
        processMsgs(self, pkg);
      } else {
        processMsg(self, pkg);
      }
    } catch(e) {
      logger.error('[pomelo-rpc] rpc client process message with error: %j', e.stack);
    }
  });

  this.socket.on('open', function() {
    logger.info('ws socket connected.');
    if(self.connected) {
      return;
    }
    self.connected = true;
    self.connecting = false;
    self.heartbeat();
    if(self.bufferMsg) {
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }
    utils.invokeCallback(cb);
  });

  this.socket.on('pong', function() {
    self.heartbeat();
  });

  this.socket.on('error', function(err) {
    logger.error('[pomelo-rpc] rpc socket is error, remote server host: %s, port: %s', self.host, self.port);
    self.emit('close', self.id);
    utils.invokeCallback(cb, err);
  });

  this.socket.on('close', function(reason) {
    logger.error('[pomelo-rpc] rpc socket is disconnect, reason: %s', reason);
    self.emit('close', self.id);
  });
};

/**
 * close mailbox
 */
 pro.close = function() {
  logger.info('ws mailbox close.');
  
  var self = this;

  this.connected = false;

  //clear cb timer
  for(var id in this.timeout) {
    clearCbTimeout(this, id);
  }

  if(this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  
  if(this.timer){
    clearTimeout(this.timer['ping']);
    this.timer['ping'] = null;
    clearTimeout(this.timer['pong']);
    this.timer['pong'] = null;
  }

  if(this.socket) {
    this.socket.terminate();
    this.socket.removeAllListeners();
    this.socket = null;
  }
};

/**
 * send message to remote server
 *
 * @param msg {service:"", method:"", args:[]}
 * @param opts {} attach info to send method
 * @param cb declaration decided by remote interface
 */
 pro.send = function(tracer, msg, opts, cb) {
  tracer.info('client', __filename, 'send', 'ws-mailbox try to send');
  if(!this.connected) {
    tracer.error('client', __filename, 'send', 'ws-mailbox not init');
    utils.invokeCallback(cb, tracer, new Error('ws-mailbox is not init'));
    return;
  }
  
  var self = this;
  var id = 0;
  if(cb){
      id = this.curId++;
      if(!id){
          id = this.curId++;
      }
      this.requests[id] = cb;
      setCbTimeout(this, id, tracer, cb);
  }


  var pkg;
  if(tracer.isEnabled) {
    pkg = {traceId: tracer.id, seqId: tracer.seq, source: tracer.source, remote: tracer.remote, id: id, msg: msg};
  }
  else {
    pkg = {id: id, msg: msg};
  }
  if(this.bufferMsg) {
    enqueue(this, pkg);
  } else {
    try {
      this.socket.send(JSON.stringify(pkg));
    } catch(e) {
      logger.error('[pomelo-rpc] rpc client ws send message with error: %j', e.stack);
      self.emit('close', self.id);
    }
  }
};

/**
 * Send a new heartbeat over the connection to ensure that we're still
 * connected and our internet connection didn't drop. We cannot use server side
 * heartbeats for this unfortunately.
 *
 * @api private
 */
 pro.heartbeat = function() {
  var self = this;

  if(this.timer['pong']) {
    clearTimeout(this.timer['pong']);
    this.timer['pong'] = null;
  }

  if(!this.timer['ping']) {
    this.timer['ping'] = setTimeout(ping, this.ping);
  }
  /**
   * Exterminate the connection as we've timed out.
   *
   * @api private
   */
   function pong() {
    if(self.timer['pong']) {
      clearTimeout(self.timer['pong']);
      self.timer['pong'] = null;
    }
    
    self.emit('close', self.id);
    logger.warn('pong timeout');
  }

  /**
   * We should send a ping message to the server.
   *
   * @api private
   */
   function ping() {
    if(self.timer['ping']) {
      clearTimeout(self.timer['ping']);
      self.timer['ping'] = null;
    }
    self.socket.ping();
    self.timer['pong'] = setTimeout(pong, self.pong);
  }
};

var enqueue = function(mailbox, msg) {
  mailbox.queue.push(msg);
};

var flush = function(mailbox) {
  if(!mailbox || !mailbox.queue.length) {
    return;
  }
  mailbox.socket.send(JSON.stringify(mailbox.queue));
  mailbox.queue = [];
};

var processMsgs = function(mailbox, pkgs) {
  for(var i=0, l=pkgs.length; i<l; i++) {
    processMsg(mailbox, pkgs[i]);
  }
};

var processMsg = function(mailbox, pkg) {
  clearCbTimeout(mailbox, pkg.id);
  var cb = mailbox.requests[pkg.id];
  if(!cb) {
    return;
  }
  delete mailbox.requests[pkg.id];

  var tracer = new Tracer(mailbox.opts.rpcLogger, mailbox.opts.rpcDebugLog, mailbox.opts.clientId, pkg.source, pkg.resp, pkg.traceId, pkg.seqId);
  var args = [tracer, null];

  pkg.resp.forEach(function(arg){
    args.push(arg);
  });

  cb.apply(null, args);
};

var setCbTimeout = function(mailbox, id, tracer, cb) {
  var timer = setTimeout(function() {
    logger.error('[pomelo-rpc] rpc callback timeout, remote server host: %s, port: %s', mailbox.host, mailbox.port);
    clearCbTimeout(mailbox, id);
    if(!!mailbox.requests[id]) {
      delete mailbox.requests[id];
    }
    mailbox.emit('close', mailbox.id);
    utils.invokeCallback(cb, tracer, new Error('rpc callback timeout'));
  }, mailbox.timeoutValue);
  mailbox.timeout[id] = timer;
};

var clearCbTimeout = function(mailbox, id) {
  if(!mailbox.timeout[id]) {
    logger.warn('[pomelo-rpc] timer is not exsits, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
    return;
  }
  clearTimeout(mailbox.timeout[id]);
  delete mailbox.timeout[id];
};

/**
 * Factory method to create mailbox
 *
 * @param {Object} server remote server info {id:"", host:"", port:""}
 * @param {Object} opts construct parameters
 *                      opts.bufferMsg {Boolean} msg should be buffered or send immediately.
 *                      opts.interval {Boolean} msg queue flush interval if bufferMsg is true. default is 50 ms
 */
 module.exports.create = function(server, opts) {
  return new MailBox(server, opts || {});
};