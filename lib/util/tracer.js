var uuid = require('node-uuid');

var Tracer = function(logger, enabledRpcLog, id, seq) {
	this.logger = logger;
	this.isEnabled = enabledRpcLog;
  this.id = id || uuid.v1();
  this.seq = seq || 1;
};

module.exports = Tracer;

Tracer.prototype.info = function(tag, isClient, remote, module, method, args, des) {
	if(this.isEnabled) {
    var log = {
      traceId: this.id,
      seq: this.seq++,
      tag: tag,
      rpc: isClient ?'rpc-client':'rpc-server',
      remote: remote,
      module: module,
      method: method,
      arguments: args,
      timestamp: Date.now(),
      level: 'info',
      description: des
    };
		this.logger.info(JSON.stringify(log));
	}
	return;
};

Tracer.prototype.error = function(tag, isClient, remote, module, method, args, des) {
  if(this.isEnabled) {
    var log = {
      traceId: this.id,
      seq: this.seq++,
      tag: tag,
      rpc: isClient ?'rpc-client':'rpc-server',
      remote: remote,
      module: module,
      method: method,
      arguments: args,
      timestamp: Date.now(),
      level: 'error',
      description: des
    };
    this.logger.info(JSON.stringify(log));
  }
  return;
};