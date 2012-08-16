var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../util/utils');
var defaultMailboxFactory = require('./mailbox');

var GRACE_TIMEOUT = 3000;

/**
 * Station states
 */
var STATE_INITED	= 1;	// station has inited
var STATE_STARTED	= 2;	// station has started
var STATE_CLOSED	= 3;	// station has closed

/**
 * Mail station constructor.
 * 
 * @param {Object} opts construct parameters
 */
var MailStation = function(opts) {
	EventEmitter.call(this);
	
	this.servers = opts.servers;
	this.mailboxFactory = opts.mailboxFactory || defaultMailboxFactory;
	this.serverType = opts.serverType;
	this.befores = [];
	this.afters = [];
	this.mailboxes = generateMailboxes(this.servers, opts, this.mailboxFactory);
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

	// servers format: {server-type:[{id, host, port}]}
	var self = this, count = 0, hasCB = false, mailbox, serverType;

	for(serverType in this.mailboxes) {
		// caculate the count of mailboxes
		if(!this.serverType || this.serverType !== serverType) {
			count++;
		}
	}

	// TODO: add lazy connect?
	for(serverType in this.mailboxes) {
		if(this.serverType && this.serverType === serverType) {
			continue;
		}
		mailbox = this.mailboxes[serverType];
		mailbox.on('close', function(id) {
			self.emit('close', id);
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
				self.state = STATE_STARTED;
				utils.invokeCallback(cb);
			}
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

/**
 * Generate mail boxes by server info list
 * 
 * @param  {[type]} servers [description]
 * @param  {[type]} factory [description]
 * @param  {[type]} opts    [description]
 * @return {[type]}         [description]
 */
var generateMailboxes = function(servers, opts, factory) {
	var res = {};
	for(var serverType in servers) {
		//iterate all the server types
		generateMailboxesByServerType(res, serverType, 
			servers[serverType], opts, factory);
	}
	return res;
};

/**
 * Generate mail box instances for the specified server type
 * 
 * @param  {[type]} res     [description]
 * @param  {[type]} stype   [description]
 * @param  {[type]} slist   [description]
 * @param  {[type]} factory [description]
 * @param  {[type]} opts    [description]
 * @return {[type]}         [description]
 */
var generateMailboxesByServerType = function(res, stype, slist, opts, factory) {
	var item;
	for(var i=0, l=slist.length; i<l; i++) {
		item = slist[i];
		item.type = stype;
		var mailbox = factory.create(item, opts);
		res[item.id] = mailbox;
	}
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