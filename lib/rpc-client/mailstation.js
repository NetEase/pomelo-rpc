var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../util/utils');
var defaultMailboxFactory = require('./mailbox');
var blackhole = require('./mailboxes/blackhole');

var GRACE_TIMEOUT = 3000;

/**
 * Station states
 */
var STATE_INITED	= 1;	// station has inited
var STATE_STARTED	= 2;	// station has started
var STATE_CLOSED	= 3;	// station has closed

var DEFAULT_PENDING_SIZE = 1000;		// default pending message limit

/**
 * Mail station constructor.
 * 
 * @param {Object} opts construct parameters
 */
var MailStation = function(opts) {
	EventEmitter.call(this);
	
	this.servers = reformServers(opts.servers);
	this.lazyConnect = opts.lazyConnect;
	this.opts = opts;
	this.mailboxFactory = opts.mailboxFactory || defaultMailboxFactory;
	this.serverType = opts.serverType;
	this.befores = [];
	this.afters = [];
	this.pendings = {};
	this.pendingSize = opts.pendingSize || DEFAULT_PENDING_SIZE;
	this.connecting = {};
	this.mailboxes = {};
	this.state = STATE_INITED;
};
util.inherits(MailStation, EventEmitter);

var pro = MailStation.prototype;

/**
 * Init and start station. Connect all mailbox to remote servers.
 * 
 * @param  {Function} cb(err) callback function
 * @return {Void}
 */
pro.start = function(cb) {
	if(this.state > STATE_INITED) {
		utils.invokeCallback(cb, new Error('station has started.'));
		return;
	}

	if(!this.lazyConnect) {
		this.mailboxes = generateMailboxes(this.servers, this.opts, this.mailboxFactory);
		startAllMailboxes(this, cb);
	} else {
		var self = this;
		process.nextTick(function() {
			self.state = STATE_STARTED;
			utils.invokeCallback(cb);
		});
	}
};

/**
 * Stop station and all its mailboxes
 * 
 * @param  {Boolean} force whether stop station forcely
 * @return {Void}
 */
pro.stop = function(force) {
	if(this.state !== STATE_STARTED) {
		console.warn('[pomelo-rpc] client is not running now.');
		return;
	}
	this.state = STATE_CLOSED;

	var self = this;
	function closeAll() {
		for(var id in self.mailboxes) {
			self.mailboxes[id].close();
		}
	}
	if(force) {
		closeAll();
	} else {
		setTimeout(closeAll, GRACE_TIMEOUT);
	}
};

/**
 * Dispatch rpc message to the mailbox
 * 
 * @param  {String}   serverId remote server id
 * @param  {Object}   msg      rpc invoke message
 * @param  {Object}   opts     rpc invoke option args
 * @param  {Function} cb       callback function
 * @return {Void}            
 */
pro.dispatch = function(serverId, msg, opts, cb) {
	if(this.state !== STATE_STARTED) {
		utils.invokeCallback(cb, new Error('[pomelo-rpc] client is not running now.'));
		return;
	}

	var self = this;
	var mailbox = this.mailboxes[serverId];
	if(this.lazyConnect && !mailbox) {
		if(!lazyConnect(this, serverId, this.mailboxFactory)) {
			utils.invokeCallback(cb, new Error('fail to connect to remote server:' + serverId));
			return;
		}
		addToPending(this, serverId, Array.prototype.slice.call(arguments, 0));
		return;
	}
	if(this.lazyConnect && this.connecting[serverId]) {
		// if the try to connect to remote server
		addToPending(this, serverId, Array.prototype.slice.call(arguments, 0));
		return;
	}

	var send = function(serverId, msg, opts) {
		var mailbox = self.mailboxes[serverId];
		if(!mailbox) {
			var args = [new Error('can not find mailbox with id:' + serverId)];
			doFilter(serverId, msg, opts, self.afters, 0, 'after', function() {
				utils.applyCallback(cb, args);
			});
			return;
		}

		mailbox.send(msg, opts, function() {
			var args = Array.prototype.slice.call(arguments, 0);
			doFilter(serverId, msg, opts, self.afters, 0, 'after', function() {
				utils.applyCallback(cb, args);
			});
		});
	};	// end of send
	
	doFilter(serverId, msg, opts, this.befores, 0, 'before', send);
};

/**
 * Add a before filter
 * 
 * @param  {[type]} filter [description]
 * @return {[type]}        [description]
 */
pro.before = function(filter) {
	this.befores.push(filter);
};

/**
 * Add after filter
 * 
 * @param  {[type]} filter [description]
 * @return {[type]}        [description]
 */
pro.after = function(filter) {
	this.afters.push(filter);
};

pro.filter = function(filter) {
	this.befores.push(filter);
	this.afters.push(filter);
};

/**
 * Do before or after filter 
 * 
 * @param  {[type]}   serverId [description]
 * @param  {[type]}   msg      [description]
 * @param  {[type]}   opts     [description]
 * @param  {[type]}   filters  [description]
 * @param  {[type]}   index    [description]
 * @param  {[type]}   operate  [description]
 * @param  {Function} cb       [description]
 * @return {[type]}            [description]
 */
var doFilter = function(serverId, msg, opts, filters, index, operate, cb) {
	if(index  >= filters.length) {
		utils.invokeCallback(cb, serverId, msg, opts);
		return;
	}

	var filter = filters[index];

	if(typeof filter === 'function') {
		filter(serverId, msg, opts, function(serverId, msg, opts) {
			index++;
			doFilter(serverId, msg, opts, filters, index, operate, cb);
		});
		return;
	} if(typeof filter[operate] === 'function') {
		filter[operate](serverId, msg, opts, function(serverId, msg, opts) {
			index++;
			doFilter(serverId, msg, opts, filters, index, operate, cb);
		});
		return;
	}

	index++;
	doFilter(serverId, msg, opts, filters, index, operate, cb);
};

var reformServers = function(servers) {
	var serverMap = {}, slist, i, l, item;
	for(var serverType in servers) {
		slist = servers[serverType];
		for(i=0, l=slist.length; i<l; i++) {
			item = utils.clone(slist[i]);
			item.type = serverType;
			serverMap[item.id] = item;
		}
	}
	return serverMap;
};

var startAllMailboxes = function(station, cb) {
	// servers format: {server-type:[{id, host, port}]}
	var count = 0, hasCB = false, mailbox, serverType;

	for(serverType in station.mailboxes) {
		// caculate the count of mailboxes
		if(!station.serverType || station.serverType !== serverType) {
			count++;
		}
	}

	for(serverType in station.mailboxes) {
		if(station.serverType && station.serverType === serverType) {
			continue;
		}
		mailbox = station.mailboxes[serverType];
		mailbox.on('close', function(id) {
			station.emit('close', id);
		});

		mailbox.connect(function(err) {
			count--;
			if(err) {
				if(!hasCB) {
					utils.invokeCallback(cb, err);
					hasCB = true;
				}
				return;
			}

			if(!count && !hasCB) {
				station.state = STATE_STARTED;
				utils.invokeCallback(cb);
			}
		});
	}
};

/**
 * Generate mail boxes by server info list
 * 
 * @param  {[type]} servers [description]
 * @param  {[type]} factory [description]
 * @param  {[type]} opts    [description]
 * @return {[type]}         [description]
 */
var generateMailboxes = function(servers, opts, factory) {
	var res = {}, item, mailbox;
	for(var serverId in servers) {
		item = servers[serverId];
		mailbox = factory.create(item, opts);
		res[serverId] = mailbox;
	}
	return res;
};

var lazyConnect = function(station, serverId, factory) {
	var server = station.servers[serverId];
	if(!server) {
		console.warn('[pomelo-rpc] unkonw server: %j', serverId);
		return false;
	}

	var mailbox = factory.create(server, station.opts);
	station.connecting[serverId] = true;
	station.mailboxes[serverId] = mailbox;
	mailbox.connect(function(err) {
		if(err) {
			station.emit('error', new Error('fail to connect to remote server: ' + serverId));
			// forward the msg to blackhole if fail to connect to remote server
			station.mailboxes[serverId] = blackhole;
		}
		delete station.connecting[serverId];
		flushPending(station, serverId);
	});
	return true;
};

var addToPending = function(station, serverId, args) {
	var pending = station.pendings[serverId];
	if(!pending) {
		pending = station.pendings[serverId] = [];
	}
	if(pending.length > station.pendingSize) {
		console.warn('[pomelo-rpc] station pending too much for: %j',  serverId);
		return;
	}
	pending.push(args);
};

var flushPending = function(station, serverId) {
	var pending = station.pendings[serverId];
	var mailbox = station.mailboxes[serverId];
	if(!pending.length) {
		return;
	}
	if(!mailbox) {
		console.error('[pomelo-rpc] fail to flush pending messages for empty mailbox: %j', serverId);
		return;
	}
	for(var i=0, l=pending.length; i<l; i++) {
		station.dispatch.apply(station, pending[i]);
	}
	delete station.pendings[serverId];
};

/**
 * Mail station factory function.
 * 
 * @param  {Object} opts construct paramters
 * 					opts.servers {Object} global server info map. {serverType: [{id, host, port, ...}, ...]}
 * 					opts.mailboxFactory {Function} mailbox factory function
 * @return {Object}      mail station instance
 */
module.exports.create = function(opts) {
	return new MailStation(opts);
};