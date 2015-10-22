var OutputBuffer = require('./buffer/outputBuffer');
var InputBuffer = require('./buffer/inputBuffer');

var Coder = {};

Coder.encodeClient = function(id, msg) {
	var outBuf = new OutputBuffer();
	outBuf.writeInt(id);
	var namespace = msg['namespace'];
	var serverType = msg['serverType'];
	var service = msg['service'];
	var method = msg['method'];
	var args = msg['args'] || [];
	outBuf.writeString(namespace);
	outBuf.writeString(serverType);
	outBuf.writeString(service);
	outBuf.writeString(method);
	outBuf.writeObject(args);

	return outBuf.getData();
}

Coder.encodeServer = function(id, args) {
	var outBuf = new OutputBuffer();
	outBuf.writeInt(id);
	outBuf.writeObject(args);
	return outBuf.getData();	
}

Coder.decodeServer = function(buf) {
	var inBuf = new InputBuffer(buf);
	var id = inBuf.readInt();
	var namespace = inBuf.readString();
	var serverType = inBuf.readString();
	var service = inBuf.readString();
	var method = inBuf.readString();
	var args = inBuf.readObject();
	// console.log('namespace %s serverType %s service %s method %s', namespace, serverType, service, method)
	// console.log(args);

	return {
		id: id,
		msg: {
			namespace: namespace,
			serverType: serverType,
			service: service,
			method: method,
			args: args
		}
	}
}

Coder.decodeClient = function(buf) {
	var inBuf = new InputBuffer(buf);
	var id = inBuf.readInt();
	var resp = inBuf.readObject();
	// console.log('decodeClient ~~~');
	// console.log(id);
	// console.log(resp);
	return {
		id: id,
		resp: resp
	}
}

module.exports = Coder;