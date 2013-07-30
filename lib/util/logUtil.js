var LoggerUtil = function(logger, enabledRpcLog) {
	this.logger = logger;
	this.isEnabled = enabledRpcLog;
};

module.exports = LoggerUtil;

LoggerUtil.prototype.info = function(traceId, tag, isClient, remote, module, method, des) {
	if(this.isEnabled) {
    var log = {
      traceId: traceId,
      tag: tag,
      rpc: isClient ?'rpc-client':'rpc-server',
      remote: remote,
      module: module,
      method: method,
      timestamp: Date.now(),
      level: 'info',
      description: des
    };
		this.logger.info(JSON.stringify(log));
	}
	return;
};

LoggerUtil.prototype.error = function(traceId, tag, isClient, remote, module, method, des) {
  if(this.isEnabled) {
    var log = {
      traceId: traceId,
      tag: tag,
      rpc: isClient ?'rpc-client':'rpc-server',
      remote: remote,
      module: module,
      method: method,
      timestamp: Date.now(),
      level: 'error',
      description: des
    };
    this.logger.error(JSON.stringify(log));
  }
  return;
};