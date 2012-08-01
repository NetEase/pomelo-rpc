var Server = require('../../lib/rpc-server/server');
var should = require('should');
var Client = require('../../lib/rpc-client/client');

var WAIT_TIME = 50;

var paths = [
	{namespace: 'user', serverType: 'area', path: __dirname + '../../mock-remote/area'}, 
	{namespace: 'sys', serverType: 'connector', path: __dirname + '../../mock-remote/connector'}
];

var servers = {
	'area': [
	  {id: 'area-servere-1', host: '127.0.0.1',  port: 3333}
	], 
	'connector': [
		{id: 'connector-server-1', host: '127.0.0.1',  port: 4444}, 
		{id: 'connector-server-2', host: '127.0.0.1',  port: 5555}
	]
};

var opts = {
	paths: paths, 
	servers: servers
};

var port = 3333;

describe('client', function() {
	var gateways = [];
	
	before(function(done) {
		gateways = [];
		//start remote servers
		for(var type in servers) {
			var configs = servers[type];
			for(var i=0; i<configs.length; i++) {
				var options = {
					paths: paths, 
					port: configs[i].port, 
					context: {id: configs[i].id}
				};
				var gateway = Server.create(options);
				gateways.push(gateway);
				gateway.start();
			}
		}
		done();
	}); 
	
	after(function(done) {
		//stop remote servers
		for(var i=0; i<gateways.length; i++) {
			gateways[i].stop();
		}
		done();
	});
	
	describe('#create', function() {
		it('should be ok for creating client and connecting to remote servers', function(done) {
			var client = Client.create(opts);
			
			should.exist(client);
			
			client.start(function(err) {
				should.not.exist(err);
				client.stop(true);
				done();
			});
		});

		it('should replace the default router by pass a opts.route to the create function', function(done) {
			var routeCount = 0, serverId = 'connector-server-1', callbackCount = 0;;

			var router = {
				id: 'aaa', 
				route: function(msg, routeParam, servers, cb) {
					routeCount++;
					cb(null, serverId);
				}
			};

			var opts = {
				paths: paths, 
				servers: servers, 
				router: router
			};

			var client = Client.create(opts);
			client.start(function(err) {
				should.not.exist(err);
				client.proxies.sys.connector.whoAmIRemote.doService(null, function(err, sid) {
					callbackCount++;
					serverId.should.equal(sid);
				});
			});

			setTimeout(function() {
				routeCount.should.equal(1);
				callbackCount.should.equal(1);
				client.stop();
				done();
			}, WAIT_TIME);
		});
	});
	
});