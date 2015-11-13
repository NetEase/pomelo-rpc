var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var Composer = require('../../util/composer');
var net = require('net');
var Tracer = require('../../util/tracer');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);

var DEFAULT_CALLBACK_TIMEOUT = 10 * 1000;
var DEFAULT_INTERVAL = 50;
var MSG_TYPE = 0;
var PING = 1;
var PONG = 2;
var RES_TYPE = 3;

var MailBox = function(server, opts) {
  EventEmitter.call(this);
  this.opts = opts || {};
  this.id = server.id;
  this.host = server.host;
  this.port = server.port;
  this.socket = null;
  this.composer = new Composer({maxLength: opts.pkgSize});
  this.requests = {};
  this.timeout = {};
  this.curId = 0;
  this.queue = [];
  this.bufferMsg = opts.bufferMsg;
  this.interval = opts.interval || DEFAULT_INTERVAL;
  this.timeoutValue = opts.timeout || DEFAULT_CALLBACK_TIMEOUT;

  // Heartbeat ping interval.
  this.ping = 'ping' in opts ? opts.ping : 25e3;

  // Heartbeat pong response timeout.
  this.pong = 'pong' in opts ? opts.pong : 10e3;

  this.timer = {};

  this.connected = false;
};
util.inherits(MailBox, EventEmitter);

var  pro = MailBox.prototype;

pro.connect = function(tracer, cb) {
  tracer.info('client', __filename, 'connect', 'tcp-mailbox try to connect');
  if(this.connected) {
    utils.invokeCallback(cb, new Error('mailbox has already connected.'));
    return;
  }
  var self = this;
  this.socket = net.connect({port: this.port, host: this.host}, function(err) {
    // success to connect
    self.connected = true;

    if(self.bufferMsg) {
      // start flush interval
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }
    self.heartbeat();
    utils.invokeCallback(cb, err);
  });

  this.composer.on('data', function(data) {
    if(data[0] === PONG) {
      //incoming::pong
      self.heartbeat();
    } else {
      try {
        var pkg = JSON.parse(data.toString('utf-8', 1));
        if(pkg instanceof Array) {
          processMsgs(self, pkg);
        } else {
          processMsg(self, pkg);
        }
      } catch(err) {
        if(err) {
          logger.error('tcp mailbox process data error: %j', err.stack);
        }
      }
    }
  });

  this.socket.on('data', function(data) {
    self.composer.feed(data);
  });

  this.socket.on('error', function(err) {
    self.emit('close', self.id);
  });

  this.socket.on('close', function(err) {
    self.emit('close', self.id);
  });

  this.socket.on('end', function() {
    self.emit('close', self.id);
  });
};

/**
 * close mailbox :: clear timer and close socket
 */
 pro.close = function() {
  this.connected = false;
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
    this.socket.removeAllListeners();
    this.composer.removeAllListeners();
    this.socket.destroy();
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
  tracer.info('client', __filename, 'send', 'tcp-mailbox try to send');
  if(!this.connected) {
    utils.invokeCallback(cb, tracer, new Error('not init.'));
    return;
  }

  var id = this.curId++ & 0xffffffff;
  this.requests[id] = cb;
  setCbTimeout(this, id, tracer, cb);
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
    this.socket.write(this.composer.compose(MSG_TYPE, JSON.stringify(pkg), id));
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
  if(!this.ping) return;

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

    if (!self.connected) return;

    self.connected = false;
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
    self.socket.write(self.composer.compose(PING));
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
  mailbox.socket.write(mailbox.composer.compose(MSG_TYPE, JSON.stringify(mailbox.queue), mailbox.queue[0].id));
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
    clearCbTimeout(mailbox, id);
    if(!!mailbox.requests[id]) {
      delete mailbox.requests[id];
    }
    logger.error('rpc callback timeout, remote server host: %s, port: %s', mailbox.host, mailbox.port);
    mailbox.emit('close', mailbox.id);
    utils.invokeCallback(cb, tracer, new Error('rpc callback timeout'));
  }, mailbox.timeoutValue);
  mailbox.timeout[id] = timer;
};

var clearCbTimeout = function(mailbox, id) {
  if(!mailbox.timeout[id]) {
    logger.warn('timer not exists, id: %s', id);
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