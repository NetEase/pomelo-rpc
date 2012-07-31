/**
 * Default mailbox factory
 */

 var Mailbox = require('./mailboxes/ws-mailbox');

/**
 * default mailbox factory
 * 
 * @param serverInfo {Object} single server instance info, {id, host, port, ...}
 * @return {Object} mailbox instance
 */
 module.exports.create = function(serverInfo) {
 	return Mailbox.create(serverInfo);
 };