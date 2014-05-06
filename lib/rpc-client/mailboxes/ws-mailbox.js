var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var sioClient = require('socket.io-client');
var Tracer = require('../../util/tracer');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);
var DEFAULT_CALLBACK_TIMEOUT = 10 * 1000;
var DEFAULT_INTERVAL = 50;

var MailBox = function(server, opts) {
  EventEmitter.call(this);
  this.id = server.id;
  this.host = server.host;
  this.port = server.port;
  this.requests = {};
  this.timeout = {};
  this.curId = 0;
  this.queue = [];
  this.cacheMsg = opts.cacheMsg;
  this.interval = opts.interval || DEFAULT_INTERVAL;
  this.timeoutValue = opts.timeout || DEFAULT_CALLBACK_TIMEOUT;
  this.connected = false;
  this.closed = false;
  this.opts = opts;
};
util.inherits(MailBox, EventEmitter);

var  pro = MailBox.prototype;

pro.connect = function(tracer, cb) {
  tracer.info('client', __filename, 'connect', 'ws-mailbox try to connect');
  if(this.connected) {
    utils.invokeCallback(new Error('mailbox has already connected.'));
    return;
  }

  this.socket = sioClient.connect(this.host + ':' + this.port, {'force new connection': true, 'reconnect': false});

  var self = this;
  this.socket.on('message', function(pkg) {
    try {
      if(pkg instanceof Array) {
        processMsgs(self, pkg);
      } else {
        processMsg(self, pkg);
      }
    } catch(e) {
      logger.error('rpc server process message error: %j', e.stack);
    }
  });

  this.socket.on('connect', function() {
    if(self.connected) {
      //ignore reconnect
      return;
    }
    // success to connect
    self.connected = true;
    if(self.cacheMsg) {
      // start flush interval
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }
    utils.invokeCallback(cb);
  });

  this.socket.on('error', function(err) {
    logger.error('rpc socket is error, host: %s, port: %s, with err: %j', self.host, self.port, err.stack);
    self.emit('close', self.id);
    utils.invokeCallback(cb, err);
  });

  this.socket.on('disconnect', function(reason) {
    logger.error('rpc socket is disconnect, host: %s, port: %s, reason: %s', self.host, self.port, reason);
    var reqs = self.requests, cb;
    for(var id in reqs) {
      cb = reqs[id];
      utils.invokeCallback(cb, new Error('disconnect with remote server.'));
    }
    self.emit('close', self.id);
  });
};

/**
 * close mailbox
 */
pro.close = function() {
  if(this.closed) {
    return;
  }
  this.closed = true;
  if(this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  this.socket.disconnect();
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
    utils.invokeCallback(cb, new Error('not init.'));
    return;
  }

  if(this.closed) {
    utils.invokeCallback(cb, new Error('mailbox alread closed.'));
    return;
  }

  var id = this.curId++;
  setCbTimeout(this, id);
  this.requests[id] = cb;

  var pkg;
  if(tracer.isEnabled) {
    pkg = {traceId: tracer.id, seqId: tracer.seq, source: tracer.source, remote: tracer.remote, id: id, msg: msg};
  }
  else {
    pkg = {id: id, msg: msg};
  }
  if(this.cacheMsg) {
    enqueue(this, pkg);
  } else {
    this.socket.emit('message', pkg);
  }
};

var enqueue = function(mailbox, msg) {
  mailbox.queue.push(msg);
};

var flush = function(mailbox) {
  if(mailbox.closed || !mailbox.queue.length) {
    return;
  }
  mailbox.socket.emit('message', mailbox.queue);
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

  var tracer = new Tracer(mailbox.opts.rpcLogger, mailbox.opts.rpcDebugLog, mailbox.opts.context.serverId, pkg.source, pkg.resp, pkg.traceId, pkg.seqId);
  var args = [tracer];

  pkg.resp.forEach(function(arg){
    args.push(arg);
  });

  cb.apply(null, args);
};

var setCbTimeout = function(mailbox, id) {
  var timer = setTimeout(function() {
    logger.warn('rpc request is overtime, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
    clearCbTimeout(mailbox, id);
    if(!!mailbox.requests[id]) {
      delete mailbox.requests[id];
    }
  }, mailbox.timeoutValue);
  mailbox.timeout[id] = timer;
};

var clearCbTimeout = function(mailbox, id) {
  if(!mailbox.timeout[id]) {
    logger.warn('timer is not exsits, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
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
 *                      opts.cacheMsg {Boolean} msg should be cache or send immediately.
 *                      opts.interval {Boolean} msg queue flush interval if cacheMsg is true. default is 50 ms
 */
module.exports.create = function(server, opts) {
  return new MailBox(server, opts || {});
};