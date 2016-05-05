var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var WebSocketServer = require('ws').Server;
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);
var Tracer = require('../../util/tracer');

var Acceptor = function(opts, cb){
  EventEmitter.call(this);
  this.bufferMsg = opts.bufferMsg;
  this.interval = opts.interval;  // flush interval in ms
  this.rpcDebugLog = opts.rpcDebugLog;
  this.rpcLogger = opts.rpcLogger;
  this.whitelist = opts.whitelist;
  this._interval = null;          // interval object
  this.sockets = {};
  this.msgQueues = {};
  this.cb = cb;
  this.socketId = 0;

  // Heartbeat ping interval.
  this.ping = 'ping' in opts ? opts.ping : 25e3;

  //ping timer for each client connection
  this.timer = {};
};
util.inherits(Acceptor, EventEmitter);

var pro = Acceptor.prototype;

pro.listen = function(port) {
  //check status
  if(!!this.inited) {
    utils.invokeCallback(this.cb, new Error('already inited.'));
    return;
  }
  this.inited = true;

  var self = this;

  this.server = new WebSocketServer({ port: port });

  this.server.on('error', function(err) {
    logger.error('[pomelo-rpc] rpc server is error: %j', err.stack);
    self.emit('error', err);
  });

  this.server.on('connection', function(socket) {
    logger.info('[pomelo-rpc] server socket on connection');
    socket.id = self.socketId++;
    self.sockets[socket.id] = socket;

    self.timer[socket.id] = null;
    self.heartbeat(socket.id);

    self.emit('connection', {id: socket.id, ip: socket._socket.remoteAddress});

    socket.on('message', function(pkg) {
      try {
        pkg = JSON.parse(pkg);

        if(pkg instanceof Array) {
          processMsgs(socket, self, pkg);
        } else {
          processMsg(socket, self, pkg);
        }
      } catch(e) {
        logger.error('[pomelo-rpc] rpc server process message error: %j', e.stack);
      }
    });

    socket.on('ping', function(data, flag) {
      logger.info('[pomelo-rpc] send pong');
      self.heartbeat(socket.id);
    });

    socket.on('error', function() {
      logger.error('[pomelo-rpc] ws server socket error');
    });

    socket.on('close', function(reason) {
      logger.error('ws server socket close');
      delete self.sockets[socket.id];
      delete self.msgQueues[socket.id];
      if(self.timer[socket.id]) {
        clearTimeout(self.timer[socket.id]);
      }
      delete self.timer[socket.id];
    });
  });

this.on('connection', ipFilter.bind(this));

if(this.bufferMsg) {
  this._interval = setInterval(function() {
    flush(self);
  }, this.interval);
}
};

var ipFilter = function(obj) {
  if(typeof this.whitelist === 'function') {
    var self = this;
    self.whitelist(function(err, tmpList) {
      if(err) {
        logger.error('[pomelo-rpc] %j.(RPC whitelist).', err);
        return;
      }
      if(!Array.isArray(tmpList)) {
        logger.error('[pomelo-rpc] %j is not an array.(RPC whitelist).', tmpList);
        return;
      }
      if(!!obj && !!obj.ip && !!obj.id) {
        for(var i in tmpList) {
          var exp = new RegExp(tmpList[i]);
          if(exp.test(obj.ip)) {
            return;
          }
        }
        var sock = self.sockets[obj.id];
        if(sock) {
          sock.disconnect('unauthorized');
          logger.warn('[pomelo-rpc] %s is rejected(RPC whitelist).', obj.ip);
        }
      }
    });
  }
};

pro.close = function() {
  if(!!this.closed) {
    return;
  }
  this.closed = true;
  if(this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  try {
    this.server.close();
  } catch(err) {
    logger.error('[pomelo-rpc] rpc server close error: %j', err.stack);
  }
  this.emit('closed');
};

var cloneError = function(origin) {
  // copy the stack infos for Error instance json result is empty
  var res = {
    msg: origin.msg,
    stack: origin.stack
  };
  return res;
};

var respCallback = function(socket,acceptor,pkg,tracer) {
  var args = Array.prototype.slice.call(arguments, 4);
  for(var i=0, l=args.length; i<l; i++) {
    if(args[i] instanceof Error) {
      args[i] = cloneError(args[i]);
    }
  }
  var resp;
  if(tracer.isEnabled) {
    resp = {traceId: tracer.id, seqId: tracer.seq, source: tracer.source, id: pkg.id, resp: Array.prototype.slice.call(args, 0)};
  }
  else {
    resp = {id: pkg.id, resp: Array.prototype.slice.call(args, 0)};
  }
  if(acceptor.bufferMsg) {
    enqueue(socket, acceptor, resp);
  } else {
    socket.send(JSON.stringify(resp));
  }
};

var processMsg = function(socket, acceptor, pkg) {
  var tracer = new Tracer(acceptor.rpcLogger, acceptor.rpcDebugLog, pkg.remote, pkg.source, pkg.msg, pkg.traceId, pkg.seqId);
  tracer.info('server', __filename, 'processMsg', 'ws-acceptor receive message and try to process message');

  acceptor.cb.call(null, tracer, pkg.msg, pkg.id?respCallback.bind(null,socket,acceptor,pkg,tracer):null);
};

/**
 * Send a new heartbeat over the connection to ensure that we're still
 * connected and our internet connection didn't drop. We cannot use server side
 * heartbeats for this unfortunately.
 *
 * @api private
 */
 pro.heartbeat = function(socketId) {
  var self = this;
  if(!this.ping) return;

  if(this.timer[socketId]) {
    this.sockets[socketId].heartbeat = true;
    return;
  }

  this.timer[socketId] = setInterval(ping.bind(null, self, socketId), this.ping + 5e3);
  logger.info('[pomelo-rpc] wait ping with socket id: %s' ,socketId);
};

/**
 * Exterminate the connection as we've timed out.
 */
 function ping(self, socketId) {
  //if pkg come, modify heartbeat flag, return;
  if(self.sockets[socketId].heartbeat) {
    self.sockets[socketId].heartbeat = false;
    return;
  }
  // if no pkg come
  // remove listener on socket,close socket
  if(self.timer[socketId]){
    clearInterval(self.timer[socketId]);
    self.timer[socketId] = null;
  }

  self.sockets[socketId].removeAllListeners();

  self.sockets[socketId].close();
  delete self.sockets[socketId];
  delete self.msgQueues[socketId];
  logger.warn('[pomelo-rpc] ping timeout with socket id: %s', socketId);
}

var processMsgs = function(socket, acceptor, pkgs) {
  for(var i=0, l=pkgs.length; i<l; i++) {
    processMsg(socket, acceptor, pkgs[i]);
  }
};

var enqueue = function(socket, acceptor, msg) {
  var queue = acceptor.msgQueues[socket.id];
  if(!queue) {
    queue = acceptor.msgQueues[socket.id] = [];
  }
  queue.push(msg);
};

var flush = function(acceptor) {
  var sockets = acceptor.sockets, queues = acceptor.msgQueues, queue, socket;
  for(var socketId in queues) {
    socket = sockets[socketId];
    if(!socket) {
      // clear pending messages if the socket not exist any more
      delete queues[socketId];
      continue;
    }
    queue = queues[socketId];
    if(!queue.length) {
      continue;
    }
    socket.send(JSON.stringify(queue));
    queues[socketId] = [];
  }
};

/**
 * create acceptor
 *
 * @param opts init params
 * @param cb(tracer, msg, cb) callback function that would be invoked when new message arrives
 */
 module.exports.create = function(opts, cb) {
  return new Acceptor(opts || {}, cb);
};
