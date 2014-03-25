var domain = require('domain');
var utils = require('../util/utils');
var constants = require('../util/constants');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);

/**
 * Failover rpc failure process. This will try other servers with option retries.
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param serverId {String} rpc remote target server id.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param cb {Function} user rpc callback.
 *
 * @api private
 */
var failover = function(client, tracer, serverId, msg, opts, cb) {
	var counter = 0;
	var success = true;
	var serverType = msg.serverType;
	var retries = opts.retries || constants.DEFAULT_PARAM.FAILOVER_RETRIES;
	var servers = client._station.serversMap[serverType];
	if(!servers.length)	{
		logger.error('[pomelo-rpc] rpc target not exist serverType: %s', serverType);
		return;
	}
	// put serverId first place
	var index = servers.indexOf(serverId);
	if(index >= 0) {
		servers.splice(index, 1);
	}
	servers.splice(0, 0, serverId);

	if(servers.length < retries) {
		logger.warn('[pomelo-rpc] rpc retries option configure with error, for it is larger than the servers length');
		retries = servers.length;
	}

	do {
		try	{
			success = true;
			handle(client, tracer, msg, opts, servers[counter], function(args) {
				utils.applyCallback(cb, args);
			});
		}	catch(e) {
			logger.error('[pomelo-rpc] rpc client encounters with error: %j', e.stack);
			success = false;
			counter++;
		}
	} while(counter < retries + 1 && !success)
	if(counter === retries + 1 && !success)	{
		utils.invokeCallback(cb);
	}
};

/**
 * Failsafe rpc failure process. This will try catch error in rpc client.
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param serverId {String} rpc remote target server id.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param cb {Function} user rpc callback.
 *
 * @api private
 */
var failsafe = function(client, tracer, serverId, msg, opts, cb) {
	try {
		handle(client, tracer, msg, opts, serverId, function(args) {
			utils.applyCallback(cb, args);
		});
	} catch(e) {
		logger.error('[pomelo-rpc] rpc client encounters with error: %j', e.stack);
		utils.invokeCallback(cb);
	}
};

/**
 * Failback rpc failure process. This will try the same server with sendInterval option and retries option.
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param serverId {String} rpc remote target server id.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param cb {Function} user rpc callback.
 *
 * @api private
 */
var failback = function(client, tracer, serverId, msg, opts, cb) {
	var interval = opts.sendIterval || constants.DEFAULT_PARAM.FAILBACK_SEND_INTERVAL;
	var retries = opts.retries || constants.DEFAULT_PARAM.FAILBACK_RETRIES;
	var d = domain.create();
	var message = Array.prototype.slice.call(arguments, 1);
	d.on('error', function(err) {
		logger.error('[pomelo-rpc] rpc client encounters with error: %j', err.stack);
		if(--retries) {
			setTimeout(function() {
				client._station.dispatch.apply(client._station, message);
			}, interval);
		} else {
			utils.invokeCallback(cb);
			d.dispose();
		}
	});
	domainHandle(d, client, tracer, msg, opts, serverId, function(args) {
		utils.applyCallback(cb, args);
		d.dispose();
	});
};

/**
 * Failfast rpc failure process. This will ignore error in rpc client.
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param serverId {String} rpc remote target server id.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param cb {Function} user rpc callback.
 *
 * @api private
 */
var failfast = function(client, tracer, serverId, msg, opts, cb) {
	handle(client, tracer, msg, opts, serverId, function(args) {
		utils.applyCallback(cb, args);
	});
};

/**
 * Handle rpc process. 
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param id {String} server id.
 * @param callback {Function} user rpc callback.
 *
 * @api private
 */
var handle = function(client, tracer, msg, opts, id, callback) {
	client._station.dispatch(tracer, id, msg, opts, function() {
		var args = Array.prototype.slice.call(arguments, 0);
		callback(args);
	});
};

/**
 * Handle rpc process with domain. 
 *
 * @param client {Object} current client instance.
 * @param tracer {Object} current rpc tracer.
 * @param msg {Object} rpc message.
 * @param opts {Object} rpc client options.
 * @param id {String} server id.
 * @param callback {Function} user rpc callback.
 *
 * @api private
 */
var domainHandle = function(domain, client, tracer, msg, opts, id, callback) {
	domain.run(function() {
		client._station.dispatch(tracer, id, msg, opts, function() {
			var args = Array.prototype.slice.call(arguments, 0);
			callback(args);
		});
	});
};

module.exports = {
	failover: failover,
	failfast: failfast,
	failback: failback,
	failsafe: failsafe
};