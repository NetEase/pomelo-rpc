var Server = require('..').server;
var config = require('./config.json');

var acceptorName = config.protocol || 'tcp';
// remote service path info list
var paths = [
  {namespace: 'user', path: __dirname + '/remote/test'}
];

var port = config.port || 8080;

var server = Server.create({paths: paths, port: port, acceptorName: acceptorName});
server.start();
console.log('rpc server started.');

process.on('uncaughtException', function (err) {
  console.error('Caught exception: ', err.stack);
});
