/**
 * RPC Client
 */

/**
 * Module dependencies
 */
var defaultRoute = require('./router').route;
var defaultMailBoxFactory = require('./mailbox');
var Loader = require('pomelo-loader');
var Proxy = require('../util/proxy');
var Station = require('./mailstation');
var utils = require('../util/utils');
var router = require('./router');

/**
 * Client states
 */
var STATE_INITED	= 1;	// client has inited
var STATE_STARTED	= 2;	// client has started
var STATE_CLOSED	= 3;	// client has closed

/**
 * RPC Client Class
 */
var Client = function(opts) {
	this._context = opts.context;
	this._routeContext = opts.routeContext;
	this.router = opts.router || router;
	this._mailboxFactory = opts.mailboxFactory;

	this._station = createStation(opts);
	this.proxies = generateProxies(this, opts.paths, this._context);
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
	if(this.state > STATE_INITED) {
		utils.invokeCallback(cb, new Error('rpc client has started.'));
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
 * @param  {Boolean} force 
 * @return {Void}       
 */
pro.stop = function(force) {
	if(this.state !== STATE_STARTED) {
		console.warn('[pomelo-rpc] client is not running now.');
		return;
	}
	this.state = STATE_CLOSED;
	this._station.stop(force);
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

pro.filter = function(filter) {
	this._station.filter(filter);
};

/**
 * Create mail station.
 *
 * @param opts {Object} construct parameters.
 *
 * @api private
 */
var createStation = function(opts) {
	return Station.create(opts);
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

	function proxyCB(serviceName, methodName, args, attach, invoke) {
		if(client.state !== STATE_STARTED) {
			throw new Error('[pomelo-rpc] fail to invoke rpc proxy for client is not running');
		}

		if(args.length < 2) {
			console.error('[pomelo-rpc] invalid rpc invoke, arguments length less than 2, namespace: %j, serverType, %j, serviceName: %j, methodName: %j', 
				attach.namespace, attach.serverType, serviceName, methodName);
			return;
		}

		var routeParam = args.shift();
		var cb = args.pop();
		var msg = {namespace: attach.namespace, serverType: attach.serverType, 
			service: serviceName, method: methodName, args: args};
		// do rpc message route caculate
		var route, target;
		if(typeof client.router === 'function') {
			route = client.router;
			target = null;
		} else if(typeof client.router.route === 'function') {
			route = client.router.route;
			target = client.router;
		} else {
			console.error('[pomelo-rpc] invalid route function.');
			return;
		}

		route.call(target, routeParam, msg, client._routeContext, function(err, serverId) {
			if(err) {
				utils.invokeCallback(cb, err);
				return;
			}

			client.rpcInvoke(serverId, msg, cb);
		});
	}	// end of proxyCB

	var item, modules, res, name;
	for(var i=0, l=paths.length; i<l; i++) {
		item = paths[i];
		modules = Loader.load(item.path, context);
		if(modules) {
			res = {};
			for(name in modules) {
				res[name] = Proxy.create({
					service: name, 
					origin: modules[name], 
					attach: item, 
					proxyCB: proxyCB
				});
			}
			createNamespace(item.namespace, proxies);
			proxies[item.namespace][item.serverType] = res;
		}
	}

	return proxies;
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
 * @param  {Object} opts client init parameter.
 *                       opts.paths: proxy path info list [{namespace, serverType, path}], 
 *                       opts.servers: global server infos({serverType: [{serverId, host, port, ...}]})
 *                       opts.context: mail box init parameter, 
 *                       opts.router: (optional) rpc message route function, route(routeParam, msg, cb), 
 *                       opts.mailBoxFactory: (optional) mail box factory instance.
 * @return {Object}      client instance.
 */
module.exports.create = function(opts) {
	return new Client(opts);
};

module.exports.WSMailbox = require('./mailboxes/ws-mailbox');
