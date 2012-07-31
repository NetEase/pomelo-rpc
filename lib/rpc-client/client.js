/**
 * RPC Client
 */

/**
 * Module dependencies
 */
var defaultRoute = require('../route/router').route;
var defaultMailBoxFactory = require('./mail-box/ws-mail-box');
var Loader = require('../util/loader');
var Proxy = require('../util/proxy');
var Station = require('./mail-station');
var utils = require('../util/utils');

/**
 * Client states
 */
var STATE_INITED	= 1;	// client has inited
var STATE_STARTED	= 1;	// client has started
var STATE_CLOSED	= 2;	// client has closed

/**
 * RPC Client Class
 */
var Client = function(opts) {
	this._pathMap = opts.pathMap;
	this._servers = opts.servers;
	this._context = opts.context;
	this._route = opts.route;
	this._mailboxFactory = opts.mailboxFactory;

	this._station = createStation(this);
	this.proxies = generateProxies(this, this.pathMap, this.context);
	this.state = STATE_INITED;
};

var pro = Client.prototype;

/**
 * Start the rpc client which would try to connect the remote servers and 
 * report the result by cb.
 *
 * @param cb {Function} cb(err)
 */
pro.start = function(cb) {
	if(this.state !== STATE_INITED) {
		console.warn('[pomelo-rpc] client has started.');
		return;
	}
	var self = this;
	this._station.start(function(err) {
		if(err) {
			console.error('[pomelo-rpc] client start fail for ' + err.stack);
			utils.invokeCallback(cb, err);
			return;
		}
		self.state = STATE_STARTED;
		utils.invokeCallback(cb);
	});
};

/**
 * Stop the rpc client.
 *
 * @param grace {Boolean} whether stop the client gracefully. True for wait for 
 *		a while(3s) to process the request that already submit and false to stop
 *		client immediately.
 */
pro.close = function(grace) {
	if(this.state !== STATE_STARTED) {
		console.warn('[pomelo-rpc] client is not running now.');
		return;
	}
	this.state = STATE_CLOSED;
	this._station.close(grace);
};

/**
 * Do the rpc invoke directly.
 *
 * @param serverId {String} remote server id
 * @param msg {Object} rpc message. Message format: 
 *		{serverType: serverType, service: serviceName, method: methodName, args: arguments}
 * @param cb {Function} cb(err, ...)
 */
pro.rpcInvoke = function(serverId, msg, cb) {
	if(this.state !== STATE_STARTED) {
		throw new Error('[pomelo-rpc] fail to do rpc invoke for client is not running');
	}
	this._station.dispatch(serverId, msg, null, cb);
};

pro.before = function(filter) {
	this._station.before(filter);
};

pro.after = function(filter) {
	this._station.after(filter);
};

/**
 * Create mail station.
 *
 * @param client {Object} current client instance.
 *
 * @api private
 */
var createStation = function(client) {
	return Station.create({
		servers: client._servers, 
		mailboxFactory: client._mailboxFactory
	});
};

/**
 * Generate proxies for remote servers.
 *
 * @param client {Object} current client instance.
 * @param paths {Object} proxy code path mapping info. [{namespace, serverType, path}, ...]
 *		key: server type, value: proxy code path (absolute path)
 * @param context {Object} mailbox init context parameter
 *
 * @api private
 */
var generateProxies = function(client, paths, context) {
	var proxies = {}, m;

	function proxyCB(namespace, serverType, serviceName, methodName, args, invoke) {
		if(this.state !== STATE_STARTED) {
			throw new Error('[pomelo-rpc] fail to invoke rpc proxy for client is not running');
		}

		if(args.length < 2) {
			console.error('[pomelo-rpc] invalid rpc invoke, arguments length less than 2, namespace: %j, serverType, %j, serviceName: %j, methodName: %j', 
				namespace, serverType, serviceName, methodName);
			return;
		}

		var routeParam = args.shift();
		var cb = args.pop();
		var msg = {namespace: namespace, serverType: serverType, 
			service: serviceName, method: methodName, args: args};
		// do rpc message route caculate
		client._route(msg, routeParam, function(err, serverId) {
			if(err) {
				utils.invokeCallback(cb, err);
				return;
			}

			client.rpcInvoke(serverId, msg, cb);
		});
	}	// end of proxyCB

	var item;
	for(var i=0, l=paths.length; i<l; i++) {
		item = paths[i];
		m = Loader.load(item.path, context, function(path, moduleName, module) {
			return Proxy.create({
				service: moduleName, 
				origin: module, 
				attach: {
					namespace: item.namespace, 
					serverType: item.serverType
				}
				proxyCB: proxyCB
			});
		});	// end of Loader.load
		if(m) {
			createNamespace(item.namespace, proxies);
			proxies[item.namespace][item.serverType] = m;
		}
	}
};

var createNamespace = function(namespace, proxies) {
	proxies[namespace] = proxies[namespace] || {};
};

/**
 * Check client init paramter.
 *
 * @api private
 */
var checkParams = function(opts) {
	if(!opts) {
		throw new Error('opts should not be empty.');
	}

	if(!opts.paths || !opts.paths.length) {
		throw new Error('opts.paths should not be empty.');
	}

	if(!opts.servers || !opts.servers.length) {
		throw new Error('opts.servers should not be empty.');
	}

	opts.route = opts.route || defaultRoute;
	opts.mailBoxFactory = opts.mailboxFactory || defaultMailBoxFactory;
};

/**
 * RPC client factory method.
 *
 * @param opts {Object} client init parameter. Opts format: 
 *		pathMap: proxy path mapping info, 
 *		servers: global server infos({serverType: [{serverId, host, port, ...}]})
 *		context: mail box init parameter, 
 *		route: rpc message route function, declaration: route(routeParam, msg, cb), 
 *		mailBoxFactory: mail box factory instance.
 */
module.exports.create = function(opts) {
	return new Client(opts);
};

module.exports.WSMailbox = require('./mailboxes/ws-mailbox');
