var logger = require('pomelo-logger').getLogger('pomelo-rpc', 'mqtt-mailbox');
var EventEmitter = require('events').EventEmitter;
var constants = require('../../util/constants');
var Tracer = require('../../util/tracer');
var MqttCon = require('mqtt-connection');
var utils = require('../../util/utils');
var util = require('util');
var net = require('net');

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
  this.keepalive = opts.keepalive || constants.DEFAULT_PARAM.KEEPALIVE;
  this.interval = opts.interval || constants.DEFAULT_PARAM.INTERVAL;
  this.timeoutValue = opts.timeout || constants.DEFAULT_PARAM.CALLBACK_TIMEOUT;
  this.keepaliveTimer = null;
  this.lastPing = -1;
  this.lastPong = -1;
  this.connected = false;
  this.closed = false;
  this.opts = opts;
};

util.inherits(MailBox, EventEmitter);

MailBox.prototype.connect = function(tracer, cb) {
  tracer && tracer.info('client', __filename, 'connect', 'mqtt-mailbox try to connect');
  if (this.connected) {
    tracer && tracer.error('client', __filename, 'connect', 'mailbox has already connected');
    return cb(new Error('mailbox has already connected.'));
  }

  var self = this;

  var stream = net.createConnection(this.port, this.host);
  this.socket = MqttCon(stream);

  this.socket.connect({
    clientId: 'MQTT_RPC_' + Date.now()
  }, function() {
    if (self.connected) {
      return;
    }

    self.connected = true;
    if (self.bufferMsg) {
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }

    self.setupKeepAlive();
    cb();
  });

  this.socket.on('publish', function(pkg) {
    pkg = pkg.payload.toString();
    try {
      pkg = JSON.parse(pkg);
      if (pkg instanceof Array) {
        processMsgs(self, pkg);
      } else {
        processMsg(self, pkg);
      }
    } catch (err) {
      logger.error('rpc client process remote server %s message with error: %s', self.id, err.stack);
    }
  });

  this.socket.on('error', function(err) {
    logger.error('rpc socket is error, remote server %s host: %s, port: %s', self.id, self.host, self.port);
    self.emit('close', self.id);
  });

  this.socket.on('pingresp', function() {
    self.lastPong = Date.now();
  });

  this.socket.on('disconnect', function(reason) {
    logger.error('rpc socket is disconnect from remote server %s, reason: %s', self.id, reason);
    var reqs = self.requests;
    for (var id in reqs) {
      var ReqCb = reqs[id];
      ReqCb(tracer, new Error('disconnect with remote server ' + self.id));
    }
    self.emit('close', self.id);
  });
};

/**
 * close mailbox
 */
MailBox.prototype.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  if (this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  this.socket.destroy();
};

/**
 * send message to remote server
 *
 * @param msg {service:"", method:"", args:[]}
 * @param opts {} attach info to send method
 * @param cb declaration decided by remote interface
 */
MailBox.prototype.send = function(tracer, msg, opts, cb) {
  tracer && tracer.info('client', __filename, 'send', 'mqtt-mailbox try to send');
  if (!this.connected) {
    tracer && tracer.error('client', __filename, 'send', 'mqtt-mailbox not init');
    cb(tracer, new Error('mqtt-mailbox is not init'));
    return;
  }

  if (this.closed) {
    tracer && tracer.error('client', __filename, 'send', 'mailbox has already closed');
    cb(tracer, new Error('mqtt-mailbox has already closed'));
    return;
  }

  var id = this.curId++;
  this.requests[id] = cb;
  setCbTimeout(this, id, tracer, cb);

  var pkg;
  if (tracer && tracer.isEnabled) {
    pkg = {
      traceId: tracer.id,
      seqId: tracer.seq,
      source: tracer.source,
      remote: tracer.remote,
      id: id,
      msg: msg
    };
  } else {
    pkg = {
      id: id,
      msg: msg
    };
  }
  if (this.bufferMsg) {
    enqueue(this, pkg);
  } else {
    doSend(this.socket, pkg);
  }
};

MailBox.prototype.setupKeepAlive = function() {
  var self = this;
  this.keepaliveTimer = setInterval(function() {
    self.checkKeepAlive();
  }, this.keepalive);
}

MailBox.prototype.checkKeepAlive = function() {
  if (this.closed) {
    return;
  }

  // console.log('checkKeepAlive lastPing %d lastPong %d ~~~', this.lastPing, this.lastPong);
  var now = Date.now();
  var KEEP_ALIVE_TIMEOUT = this.keepalive * 2;
  if (this.lastPing > 0) {
    if (this.lastPong < this.lastPing) {
      if (now - this.lastPing > KEEP_ALIVE_TIMEOUT) {
        logger.error('mqtt rpc client checkKeepAlive timeout from remote server %s for %d', this.id, KEEP_ALIVE_TIMEOUT);
        this.close();
      }
    } else {
      this.socket.pingreq();
      this.lastPing = Date.now();
    }
  } else {
    this.socket.pingreq();
    this.lastPing = Date.now();
  }
}

var enqueue = function(mailbox, msg) {
  mailbox.queue.push(msg);
};

var flush = function(mailbox) {
  if (mailbox.closed || !mailbox.queue.length) {
    return;
  }
  doSend(mailbox.socket, mailbox.queue);
  mailbox.queue = [];
};

var doSend = function(socket, msg) {
  socket.publish({
    topic: 'rpc',
    payload: JSON.stringify(msg)
  });
}

var processMsgs = function(mailbox, pkgs) {
  for (var i = 0, l = pkgs.length; i < l; i++) {
    processMsg(mailbox, pkgs[i]);
  }
};

var processMsg = function(mailbox, pkg) {
  var pkgId = pkg.id;
  clearCbTimeout(mailbox, pkgId);
  var cb = mailbox.requests[pkgId];
  if (!cb) {
    return;
  }

  delete mailbox.requests[pkgId];
  var rpcDebugLog = mailbox.opts.rpcDebugLog;
  var tracer = null;
  var sendErr = null;
  if (rpcDebugLog) {
    tracer = new Tracer(mailbox.opts.rpcLogger, mailbox.opts.rpcDebugLog, mailbox.opts.clientId, pkg.source, pkg.resp, pkg.traceId, pkg.seqId);
  }
  var pkgResp = pkg.resp;

  cb(tracer, sendErr, pkgResp);
};

var setCbTimeout = function(mailbox, id, tracer, cb) {
  var timer = setTimeout(function() {
    logger.warn('rpc request is timeout, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
    clearCbTimeout(mailbox, id);
    if (mailbox.requests[id]) {
      delete mailbox.requests[id];
    }
    logger.error('rpc callback timeout, remote server %s host: %s, port: %s', id, mailbox.host, mailbox.port);
    cb(tracer, new Error('rpc callback timeout'));
  }, mailbox.timeoutValue);
  mailbox.timeout[id] = timer;
};

var clearCbTimeout = function(mailbox, id) {
  if (!mailbox.timeout[id]) {
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
 *                      opts.bufferMsg {Boolean} msg should be buffered or send immediately.
 *                      opts.interval {Boolean} msg queue flush interval if bufferMsg is true. default is 50 ms
 */
module.exports.create = function(server, opts) {
  return new MailBox(server, opts || {});
};