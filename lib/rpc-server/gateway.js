var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../util/utils');
var Dispatcher = require('./dispatcher');
var fs = require('fs');
var Loader = require('pomelo-loader');

var Gateway = function(opts) {
  EventEmitter.call(this);
  this.opts = opts || {};
  this.port = opts.port || 3050;
  this.started = false;
  this.stoped = false;
  this.services = opts.services;
  var self = this;

  this.acceptors = {};
  this.acceptors.__defineGetter__('tcp', utils.load.bind(null, '../rpc-server/acceptors/tcp-acceptor'));
  this.acceptors.__defineGetter__('ws', utils.load.bind(null,'../rpc-server/acceptors/ws-acceptor'));

  if(!!opts.acceptorName && opts.acceptorName === 'ws') {
    this.acceptorFactory = this.acceptors.ws;
  } else {
    this.acceptorFactory = this.acceptors.tcp;
  }

  if(!!opts.acceptorFactory) {
    this.acceptorFactory = opts.acceptorFactory;
  }

  var dispatcher = new Dispatcher(this.services);
  this.acceptor = this.acceptorFactory.create(opts, function(tracer, msg, cb) {
    dispatcher.route(tracer, msg, cb);
  });
  if(!!this.opts.reloadRemotes) {
    watchServices(this, dispatcher);
  }
};

util.inherits(Gateway, EventEmitter);

var pro = Gateway.prototype;

pro.stop = function() {
  if(!this.started || this.stoped) {
    return;
  }
  this.stoped = true;
  try {
    this.acceptor.close();
  } catch(err) {}
};

pro.start = function() {
  if(this.started) {
    throw new Error('gateway already start.');
  }
  this.started = true;

  var self = this;
  this.acceptor.on('error', self.emit.bind(self, 'error'));
  this.acceptor.on('closed', self.emit.bind(self, 'closed'));
  this.acceptor.listen(this.port);
};

/**
 * create and init gateway
 *
 * @param opts {services: {rpcServices}, connector:conFactory(optional), router:routeFunction(optional)}
 */
module.exports.create = function(opts) {
  if(!opts || !opts.services) {
    throw new Error('opts and opts.services should not be empty.');
  }

  return new Gateway(opts);
};


var watchServices = function(gateway, dispatcher) {
  var paths = gateway.opts.paths;
  var app = gateway.opts.context;
  for(var i=0; i<paths.length; i++) {
    (function(index) {
      fs.watch(paths[index].path, function(event, name) {
        if(event === 'change') {
          var res = {};
          var item = paths[index];
          var m = Loader.load(item.path, app);
          if(m) {
            createNamespace(item.namespace, res);
            for(var s in m) {
              res[item.namespace][s] = m[s];
            }
          }
          dispatcher.emit('reload', res);
        }
      });
    })(i);
  }
};

var createNamespace = function(namespace, proxies) {
  proxies[namespace] = proxies[namespace] || {};
};
