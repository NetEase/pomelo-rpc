var logger = require('pomelo-logger').getLogger('pomelo-rpc', 'InputBuffer');

var InputBuffer = function(buffer) {
	this.buf = buffer;
	this.pos = 0;
	this.count = buffer.length;
}

InputBuffer.prototype.read = function() {
	return this.readByte();
}

InputBuffer.prototype.readBoolean = function() {
	var r = this.read();
	if (r < 0) {
		throw new Error('EOFException');
	}

	return (r != 0);
}

InputBuffer.prototype.readByte = function() {
	return (this.pos < this.count) ? (this.buf[this.pos++] & 0xff) : -1;
}

InputBuffer.prototype.readBytes = function() {
	var len = this.readInt();
	this.check(len);
	var r = this.buf.slice(this.pos, this.pos + len);
	this.pos += len;
	return r;
}

InputBuffer.prototype.readChar = function() {
	return this.readByte();
}

InputBuffer.prototype.readDouble = function() {
	this.check(8);
	var r = this.buf.readDoubleLE(this.pos);
	this.pos += 8;
	return r;
}

InputBuffer.prototype.readFloat = function() {
	this.check(4);
	var r = this.buf.readFloatLE(this.pos);
	this.pos += 4;
	return r;
}

InputBuffer.prototype.readInt = function() {
	this.check(4);
	var r = this.buf.readInt32LE(this.pos);
	this.pos += 4;
	return r;
}

InputBuffer.prototype.readShort = function() {
	this.check(2);
	var r = this.buf.readInt16LE(this.pos);
	this.pos += 2;
	return r;
}

InputBuffer.prototype.readUInt = function() {
	this.check(4);
	var r = this.buf.readUInt32LE(this.pos);
	this.pos += 4;
	return r;
}

InputBuffer.prototype.readUShort = function() {
	this.check(2);
	var r = this.buf.readUInt16LE(this.pos);
	this.pos += 2;
	return r;
}

InputBuffer.prototype.readString = function() {
	var len = this.readInt();
	this.check(len);
	var r = this.buf.toString('utf8', this.pos, this.pos + len);
	this.pos += len;
	return r;
}

InputBuffer.prototype.readObject = function() {
	var type = this.readString();
	var instance = null;
	// console.log('readObject %s', type)
	switch (type) {
		case 'string':
			instance = this.readString();
			break;
		case 'number':
			instance = this.readInt();
			break;
		case 'float':
			instance = this.readFloat();
			break;
		case 'boolean':
			instance = this.readBoolean();
			break;
		case 'array':
			instance = [];
			var len = this.readInt();
			for (var i = 0; i < len; i++) {
				instance.push(this.readObject());
			}
			break;
		case 'object':
			var objStr = this.readString();
			instance = JSON.parse(objStr);
			// var id = this.readString();
			// instance = bearcat.getBean(id);
			// if (!instance) {
			// 	logger.error('readObject no such bean error with id:%j', id);
			// 	return;
			// }

			// instance.readFields(this);
			break;
		case 'buffer':
			instance = this.readBytes();
			break;
		case 'null':
			break;
		default:
			logger.error('readObject invalid read type %j', type);
			break;
	}

	return instance;
}

InputBuffer.prototype.check = function(len) {
	if (this.pos + len > this.count) {
		throw new Error('IndexOutOfBoundsException');
	}
}

module.exports = InputBuffer;