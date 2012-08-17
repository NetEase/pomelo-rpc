var MailStation = require('../../lib/rpc-client/mailstation');
var should = require('should');
var Server = require('../../lib/rpc-server/server');

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

var msg = {
	namespace: 'user', 
	serverType: 'area', 
	service: 'whoAmIRemote', 
	method: 'doService', 
	args: []
};

var opts = {
	servers: servers
};

describe('mail station', function() {
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
		it('should be ok for creating and connect to the right remote servers', function(done) {
			var station = MailStation.create(opts);
			should.exist(station);

			station.start(function(err) {
				should.not.exist(err);
				station.stop();
				done();
			});
		}); 
		
		it('should return an error if connect fail', function(done) {
			var wrongOpts = {
				servers: {
					'area': [
					  {id:'some-wrong-id', host:'127.0.0.1', port: 1234}
					]
				}
			};
			
			var station = MailStation.create(wrongOpts);
			should.exist(station);

			station.start(function(err) {
				should.exist(err);
				done();
			});
		});

		it('should change the default mailbox by pass the mailboxFactory to the create function', function(done) {
			var constructCount = 0, connectCount = 0, closeCount = 0, startCount = 0;

			var MockMailbox = function(opts, cb) {
				constructCount++;
			};

			MockMailbox.prototype.connect = function(cb) {
				connectCount++;
				cb();
			};

			MockMailbox.prototype.close = function(force) {
				closeCount++;
			};

			MockMailbox.prototype.on = function() {};

			MockMailbox.prototype.emit = function() {};

			var mailboxFactory = {
				create: function(opts, cb) {
					return new MockMailbox(null, cb);
				}
			};

			var opts = {
				paths: paths, 
				servers: servers, 
				mailboxFactory: mailboxFactory
			};

			var station = MailStation.create(opts);
			
			should.exist(station);
			
			station.start(function(err) {
				should.not.exist(err);
				startCount++;
				station.stop(true);
			});
			
			setTimeout(function() {
				constructCount.should.equal(3);
				connectCount.should.equal(3);
				closeCount.should.equal(3);
				startCount.should.equal(1);
				done();
			}, WAIT_TIME);
		});
	});
	
	describe('#dispatch', function() {
		it('should send request to the right remote server and get the response from callback function', function(done) {
			var callbackCount = 0;
			var count = 0;
			var station = MailStation.create(opts);
			should.exist(station);

			station.start(function(err) {
				should.exist(station);
				for(var type in servers) {
					var configs = servers[type];
					for(var i=0; i<configs.length; i++) {
						count++;
						station.dispatch(configs[i].id, msg, null, (function(id) {
							return function(err, remoteId) {
								remoteId.should.equal(id);
								callbackCount++;
							};
						})(configs[i].id));
					}
				}
			});
			setTimeout(function() {
				callbackCount.should.equal(count);
				station.stop();
				done();
			}, WAIT_TIME);
		});

		it('should send request to the right remote server and get the response from callback function in lazy connect mode', function(done) {
			var opts = {
				servers: servers, 
				lazyConnect: true
			};
			var callbackCount = 0;
			var count = 0;
			var station = MailStation.create(opts);
			should.exist(station);

			station.start(function(err) {
				should.exist(station);
				for(var type in servers) {
					var configs = servers[type];
					for(var i=0; i<configs.length; i++) {
						count++;
						station.dispatch(configs[i].id, msg, null, (function(id) {
							return function(err, remoteId) {
								remoteId.should.equal(id);
								callbackCount++;
							};
						})(configs[i].id));
					}
				}
			});
			setTimeout(function() {
				callbackCount.should.equal(count);
				station.stop();
				done();
			}, WAIT_TIME);
		});

		it('should emit error info and forward message to blackhole if fail to connect to remote server in lazy connect mode', function(done) {
			// mock data
			var serverId = 'invalid-server-id';
			var servers = {
				'invalid-server': [
					{id: serverId, host: 'localhost', port: 1234}
				]
			};
			var opts = {
				servers: servers, 
				lazyConnect: true
			};
			var callbackCount = 0;
			var eventCount = 0;
			var station = MailStation.create(opts);
			should.exist(station);

			station.on('error', function(err) {
				should.exist(err);
				('fail to connect to remote server: ' + serverId).should.equal(err.message);
				eventCount++;
			});

			station.start(function(err) {
				should.exist(station);
				station.dispatch(serverId, msg, null, function(err) {
					should.exist(err);
					'message was forward to blackhole.'.should.equal(err.message);
					callbackCount++;
				});
			});
			setTimeout(function() {
				eventCount.should.equal(1);
				callbackCount.should.equal(1);
				station.stop();
				done();
			}, WAIT_TIME);
		});
	});
	
	describe('#close', function() {
		it('should emit a close event for each mailbox close', function(done) {
			var closeEventCount = 0;
			var remoteIds = [];
			var mailboxIds = [];
			for(var type in servers) {
				var configs = servers[type];
				for(var i=0; i<configs.length; i++) {
					remoteIds.push(configs[i].id);
				}
			}
			remoteIds.sort();
			
			var station = MailStation.create(opts);
			should.exist(station);
			station.start(function(err) {
				station.on('close', function(mailboxId) {
					mailboxIds.push(mailboxId);
					closeEventCount++;
				});
				station.stop(true);
			});
			
			setTimeout(function() {
				closeEventCount.should.equal(remoteIds.length);
				mailboxIds.sort();
				mailboxIds.should.eql(remoteIds);
				done();
			}, WAIT_TIME);
		});
		
		it('should return an error when try to dispatch message by a closed station', function(done) {
			var errorEventCount = 0;
			var count = 0;

			var station = MailStation.create(opts);
			should.exist(station);
			station.start(function(err) {
				station.stop();
				for(var type in servers) {
					var configs = servers[type];
					for(var i=0; i<configs.length; i++) {
						count++;
						station.dispatch(configs[i].id, msg, null, function(err, remoteId, attach) {
							should.exist(err);
							errorEventCount++;
						});
					}
				}
			});
			setTimeout(function() {
				errorEventCount.should.equal(count);
				done();
			}, WAIT_TIME);
		});
	});
	
	describe('#filters', function() {
		it('should invoke filters in turn', function(done) {
			var preFilterCount = 0;
			var afterFilterCount = 0;
			var sid = 'logic-server-1';
			var orgMsg = msg;
			var orgOpts = {something: 'hello'};
			
			var station = MailStation.create(opts);
			should.exist(station);
			station.start(function(err) {
				station.before(function(fsid, fmsg, fopts, next) {
					preFilterCount.should.equal(0);
					afterFilterCount.should.equal(0);
					fsid.should.equal(sid);
					fmsg.should.equal(msg);
					fopts.should.equal(orgOpts);
					preFilterCount++;
					next(fsid, fmsg, fopts);
				});
				
				station.before(function(fsid, fmsg, fopts, next) {
					preFilterCount.should.equal(1);
					afterFilterCount.should.equal(0);
					fsid.should.equal(sid);
					fmsg.should.equal(msg);
					fopts.should.equal(orgOpts);
					preFilterCount++;
					next(fsid, fmsg, fopts);
				});
				
				station.after(function(fsid, fmsg, fopts, next) {
					preFilterCount.should.equal(2);
					afterFilterCount.should.equal(0);
					fsid.should.equal(sid);
					fmsg.should.equal(msg);
					fopts.should.equal(orgOpts);
					afterFilterCount++;
					next(fsid, fmsg, fopts);
				});
				
				station.after(function(fsid, fmsg, fopts, next) {
					preFilterCount.should.equal(2);
					afterFilterCount.should.equal(1);
					fsid.should.equal(sid);
					fmsg.should.equal(msg);
					fopts.should.equal(orgOpts);
					afterFilterCount++;
					next(fsid, fmsg, fopts);
				});
				
				station.dispatch(sid, orgMsg, orgOpts, function() {});
			});
			
			setTimeout(function() {
				preFilterCount.should.equal(2);
				afterFilterCount.should.equal(2);
				station.stop();
				done();
			}, WAIT_TIME);
		});
	});
});