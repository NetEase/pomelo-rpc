var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var sioClient = require('socket.io-client');

var MailBox = function(opts) {
	EventEmitter.call(this);
	this.id = opts.id;
	this.host = opts.host;
	this.port = opts.port;
	this.requests = {};
	this.curId = 0;
};
util.inherits(MailBox, EventEmitter);

var  pro = MailBox.prototype;

pro.connect = function(cb) {
	if(!!this.inited) {
		utils.invokeCallback(new Error('already inited.'));
		return;
	}
	this.inited = true;
	
	this.socket = sioClient.connect(this.host + ':' + this.port, {'force new connection': true});
	
	var self = this;
	this.socket.on('message', function(pkg) {
		var cb = self.requests[pkg.id];
		delete self.requests[pkg.id];
		
		if(!cb) {
			return;
		}
		
		cb.apply(null, pkg.resp);
	});
	
	this.socket.on('connect', function() {
		if(!!this.connected) {
			//ignore reconnect
			return;
		}
		this.connected = true;
		utils.invokeCallback(cb);
	});
	
	this.socket.on('error', function(err) {
		utils.invokeCallback(cb, err);
	});
	
	this.socket.on('disconnect', function(reason) {
		if(reason === 'booted') {
			//disconnected by call disconnect function
			self.emit('close', self.id);
		} else {
			//some other reason such as heartbeat timeout
		}
	});

	this.socket.on('reconnect_failed', function() {
		self.emit('reconnectFail');
	});
};

/**
 * close mailbox
 */
pro.close = function() {
	if(!!this.closed) {
		return;
	}
	this.closed = true;
	this.socket.disconnect();
};

/**
 * send message to remote server
 * 
 * @param msg {service:"", method:"", args:[]}
 * @param opts {} attach info to send method
 * @param cb declaration decided by remote interface
 */
pro.send = function(msg, opts, cb) {
	if(!this.inited) {
		utils.invokeCallback(cb, new Error('not init.'));
		return;
	}
	
	if(!!this.closed) {
		utils.invokeCallback(cb, new Error('mailbox alread closed.'));
		return;
	}
	
	var id = this.curId++;
	this.requests[id] = cb;
	this.socket.emit('message', {id: id, msg: msg});
};

/**
 * Factory method to create mailbox
 * 
 * @param opts remote server info {id:"", host:"", port:""}
 */
module.exports.create = function(opts) {
	return new MailBox(opts);
};