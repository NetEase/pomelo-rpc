module.exports.client = require('./lib/rpc-server/client');
module.exports.server = require('./lib/rpc-client/server');
module.exports.mailboxes = {
	ws: require('./lib/rpc-client/ws-mail-box');
};
module.exports.acceptors = {
	ws: require('./lib/rpc-server/ws-acceptor');
};