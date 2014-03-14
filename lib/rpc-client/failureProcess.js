var domain = require('domain');
var utils = require('../util/utils');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);

var failover = function(client, tracer, serverId, msg, opts, cb) {
	var serverType = msg.serverType;
	var counter = 0;
	var d = domain.create();
	var retries = opts.retries || 2;
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
	d.on('error', function(err) {
		logger.error('[pomelo-rpc] rpc client encounters with error: %j', err.stack);
		counter++;
		if(counter < retries + 1) {
			domainHandle(client, tracer, msg, opts, d, servers[counter], function(args) {
				utils.applyCallback(cb, args);
			});
		}
		utils.invokeCallback(cb);
	});
	domainHandle(client, tracer, msg, opts, d, servers[counter], function(args) {
		utils.applyCallback(cb, args);
	});
};

var failsafe = function(client, tracer, serverId, msg, opts, cb) {
	try {
		handle(client, tracer, msg, opts, serverId, function(args) {
			utils.applyCallback(cb, args);
		});
	} catch(e) {
		logger.error('[pomelo-rpc] rpc client encounters with error: %j', e.stack);
	}
};

var failback = function(client, tracer, serverId, msg, opts, cb) {
	var interval = opts.sendIterval || 10 * 1000;
	var retries = opts.retries || 5;
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
	domainHandle(client, tracer, msg, opts, d, serverId, function(args) {
		utils.applyCallback(cb, args);
	});
};

var failfast = function(client, tracer, serverId, msg, opts, cb) {
	handle(client, tracer, msg, opts, serverId, function(args) {
		utils.applyCallback(cb, args);
	});
};

var handle = function(client, tracer, msg, opts, id, callback) {
	client._station.dispatch(tracer, id, msg, opts, function() {
		var args = Array.prototype.slice.call(arguments, 0);
		callback(args);
	});
};

var domainHandle = function(client, tracer, msg, opts, domain, id, callback) {
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