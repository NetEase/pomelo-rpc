var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var sio = require('socket.io');

var Acceptor = function(opts, cb){
	EventEmitter.call(this);
	this.cb = cb;
};
util.inherits(Acceptor, EventEmitter);

var pro = Acceptor.prototype;

pro.listen = function(port) {
	//check status
	if(!!this.inited) {
		utils.invokeCallback(self.cb, new Error('already inited.'));
		return;
	}
	this.inited = true;
	
	var self = this;
	
	this.server = sio.listen(port);
	
	this.server.set('log level', 0);
	
	this.server.server.on('error', function(err) {
		self.emit('error', err);
	});

	this.server.sockets.on('connection', function(socket) {
		socket.on('message', function(pkg) {
			self.cb.call(null, pkg.msg, function() {
				var args = Array.prototype.slice.call(arguments, 0);
				for(var i=0, l=args.length; i<l; i++) {
					if(args[i] instanceof Error) {
						args[i] = cloneError(args[i]);
					}
				}
				socket.emit('message', {id: pkg.id, resp: Array.prototype.slice.call(args, 0)});
			});
		});
	});
	
};

pro.close = function() {
	if(!!this.closed) {
		return;
	}
	this.closed = true;
	try {
		this.server.server.close();
	} catch(err){
	}
	this.emit('closed');
};

var cloneError = function(origin) {
	var res = {};
	res.msg = origin.msg;
	res.stack = origin.stack;
	return res;
};

/**
 * create acceptor
 * 
 * @param opts init params 
 * @param cb(msg, cb) callback function that would be invoked when new message arrives
 */
module.exports.create = function(opts, cb) {
	return new Acceptor(opts, cb);
};
