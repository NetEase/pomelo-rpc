var Client = require('..').client;
var config = require('./config.json');

//for test param
var mailboxName = config.protocol || 'tcp';
var period = config.interval;  //ms
var msg = config.msg;
var host = config.host || '127.0.0.1';

// remote service interface path info list
var records = [
  {namespace: 'user', serverType: 'test', path: __dirname + '/remote/test'}
];

var context = {
  serverId: 'test-server-1'
};

// server info list
var servers = [
  {id: 'test-server-1', serverType: 'test', host: host, port: 3333}
];

// route parameter passed to route function
var routeParam = null;

// route context passed to route function
var routeContext = servers;

// route function to caculate the remote server id
var routeFunc = function(routeParam, msg, routeContext, cb) {
  cb(null, routeContext[0].id);
};

var client = Client.create({routeContext: routeContext, router: routeFunc, context: context, mailboxName: mailboxName});

client.start(function(err) {
  console.log('rpc client start ok.');

  client.addProxies(records);
  client.replaceServers(servers);

  var func = function(){
    client.proxies.user.test.service.echo(routeParam, msg, function(err, resp) {
      if(err) {
        console.error(err.stack);
      }
      console.log(resp);
    });
  }

  setInterval(func, period);
});


process.on('uncaughtException', function (err) {
        console.error('Caught exception: ', err.stack);
});
