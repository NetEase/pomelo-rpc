var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var net = require('net');
var Composer = require('../../util/composer');
var Tracer = require('../../util/tracer');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);

var MSG_TYPE = 0;
var PING = 1;
var PONG = 2;
var RES_TYPE = 3;

var Acceptor = function(opts, cb){
  EventEmitter.call(this);
  opts = opts || {};
  this.bufferMsg = opts.bufferMsg;
  this.interval = opts.interval;  // flush interval in ms
  this.pkgSize = opts.pkgSize;
  this._interval = null;          // interval object
    // Heartbeat ping interval.
  this.ping = 'ping' in opts ? opts.ping : 25e3;

  // Heartbeat pong response timeout.
  this.pong = 'pong' in opts ? opts.pong : 10e3;

  //ping pong timer for each client connection {id0:{ping:pingTimer, pong: pongTimer},id1:{}......}
  this.timer = {};

  this.server = null;
  this.sockets = {};
  this.msgQueues = {};
  this.cb = cb;
  this.socketId = 0;
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

  this.server = net.createServer();
  this.server.listen(port);

  this.server.on('error', function(err) {
    self.emit('error', err, this);
  });

  this.server.on('connection', function(socket) {
    socket.id = self.socketId++;
    self.sockets[socket.id] = socket;
    socket.composer = new Composer({maxLength: self.pkgSize});
    self.timer[socket.id] = {};
    self.heartbeat(socket.id);
    socket.on('data', function(data) {
      socket.composer.feed(data);
    });

    socket.composer.on('data', function(data) {
      console.log(data[0]); 
      if(data[0] === PING){
        //incoming::ping
        socket.write(socket.composer.compose(PONG));
      }else if(data[0] === PONG){
        //incoming::pong
        self.connected = true;
        if(self.timer[socket.id]['pong']){
          clearTimeout(self.timer[socket.id]['pong']);
          self.timer[socket.id]['pong'] = null;
        }
        self.heartbeat(socket.id);
      }else{
        try{
          var pkg = JSON.parse(data.toString('utf-8', 1));
          var id  = null;
          //
          if(pkg instanceof Array) {
            processMsgs(socket, self, pkg, id);
          } else {
            processMsg(socket, self, pkg, id);
          }
        }catch(err){ //json parse exception 
          if(err){
            socket.composer.reset();
            logger.error(err);
          }
        }
      }
    });

    socket.on('close', function() {
      delete self.sockets[socket.id];
      delete self.msgQueues[socket.id];
      if(self.timer[socket.id]){
        clearTimeout(self.timer[socket.id]['ping']);
        clearTimeout(self.timer[socket.id]['pong']);
      }
      delete self.timer[socket.id];
    });
  });

  if(this.bufferMsg) {
    this._interval = setInterval(function() {
      flush(self);
    }, this.interval);
  }
};

/**
 * Send a new heartbeat over the connection to ensure that we're still
 * connected and our internet connection didn't drop. We cannot use server side
 * heartbeats for this unfortunately.
 *
 * @api private
 */
pro.heartbeat = function(socketId){
  var self = this;
  if(!self.ping) return;
  /**
   * Exterminate the connection as we've timed out.
   *
   * @api private
   */
  function pong() {
    // notify application offline
    //remove listener on socket
    if(self.timer[socketId]){
        clearTimeout(self.timer[socketId]['ping']);
        clearTimeout(self.timer[socketId]['pong']);
    }
    delete self.timer[socketId];
    self.sockets[socketId].composer.removeAllListeners();
    self.sockets[socketId].removeAllListeners();
    if(self.timer[socketId]){
        clearTimeout(self.timer[socketId]['ping']);
        clearTimeout(self.timer[socketId]['pong']);
    }
    delete self.timer[socketId];
    self.sockets[socketId].end();
    delete self.sockets[socketId];
    delete self.msgQueues[socketId];
    console.log('pong timeouti,',socketId);

  }

  /**
   * We should send a ping message to the client.
   *
   * @api private
   */
  function ping() {
    if(self.timer[socketId]['ping']){
      clearTimeout(self.timer[socketId]['ping']);
      self.timer[socketId]['ping'] = null;
    }
    self.sockets[socketId].write(self.sockets[socketId].composer.compose(PING));
    //self.emit('outgoing::ping', value);
    self.timer[socketId]['pong'] = setTimeout(pong, self.pong);
  }
  if(!self.timer[socketId]['ping']){
    self.timer[socketId]['ping'] = setTimeout(ping, self.ping);
      console.log('set ping: ' ,socketId)
  }
}


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
    console.error('rpc server close error: %j', err.stack);
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
//need to redefine response
var processMsg = function(socket, acceptor, pkg, id) {
  var tracer = new Tracer(acceptor.rpcLogger, acceptor.rpcDebugLog, pkg.remote, pkg.source, pkg.msg, pkg.traceId, pkg.seqId);
  tracer.info('server', __filename, 'processMsg', 'tcp-acceptor receive message and try to process message');
  acceptor.cb.call(null, tracer, pkg.msg, function() {
    var args = Array.prototype.slice.call(arguments, 0);
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
      socket.write(socket.composer.compose(RES_TYPE, JSON.stringify(resp), id));
    }
  });
};

var processMsgs = function(socket, acceptor, pkgs, id) {
  for(var i=0, l=pkgs.length; i<l; i++) {
    processMsg(socket, acceptor, pkgs[i], id);
  }
};

var enqueue = function(socket, acceptor, msg) {
  var queue = acceptor.msgQueues[socket.id];
  if(!queue) {
    queue = acceptor.msgQueues[socket.id] = [];
  }
  queue.push(msg);
};
//need modify
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
    socket.write(socket.composer.compose(JSON.stringify(queue)));
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

process.on('SIGINT', function() {
  process.exit();
});
