var acceptor = require('./acceptors/tcp-acceptor');

module.exports.create = function(opts, cb) {
  return acceptor.create(opts, cb);
};