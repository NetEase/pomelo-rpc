var Utils = {};

Utils.invokeCallback = function(cb) {
	if (typeof cb === 'function') {
		cb.apply(null, Array.prototype.slice.call(arguments, 1));
	}
};

Utils.applyCallback = function(cb, args) {
	if (typeof cb === 'function') {
		cb.apply(null, args);
	}
};

Utils.getObjectClass = function(obj) {
	if (!obj) {
		return;
	}

	var constructor = obj.constructor;
	if (!constructor) {
		return;
	}

	if (constructor.name) {
		return constructor.name;
	}

	var str = constructor.toString();
	if (!str) {
		return;
	}

	var arr = null;
	if (str.charAt(0) == '[') {
		arr = str.match(/\[\w+\s*(\w+)\]/);
	} else {
		arr = str.match(/function\s*(\w+)/);
	}

	if (arr && arr.length == 2) {
		return arr[1];
	}
};

/**
 * Utils check array
 *
 * @param  {Array}   array
 * @return {Boolean} true|false
 * @api public
 */
Utils.checkArray = function(array) {
	return Object.prototype.toString.call(array) == '[object Array]';
}

/**
 * Utils check float
 *
 * @param  {Float}   float
 * @return {Boolean} true|false
 * @api public
 */
Utils.checkFloat = function(v) {
	return v && (parseInt(v) === v);
}

/**
 * Utils check function
 *
 * @param  {Function}   func function
 * @return {Boolean}    true|false
 * @api public
 */
Utils.checkFunction = function(func) {
	return func && (typeof func === 'function');
}

/**
 * Utils check object
 *
 * @param  {Object}   obj object
 * @return {Boolean}  true|false
 * @api public
 */
Utils.checkObject = function(obj) {
	return obj && (typeof obj === 'object');
}

/**
 * Utils check string
 *
 * @param  {Object}   obj string
 * @return {Boolean}  true|false
 * @api public
 */
Utils.checkString = function(obj) {
	return obj && (typeof obj === 'string');
}

/**
 * Utils check number
 *
 * @param  {Object}   obj object
 * @return {Boolean}  true|false
 * @api public
 */
Utils.checkNumber = function(obj) {
	return obj && (typeof obj === 'number');
}

/**
 * Utils check boolean
 *
 * @param  {Object}   obj object
 * @return {Boolean}  true|false
 * @api public
 */
Utils.checkBoolean = function(obj) {
	return obj && (typeof obj === 'boolean');
}

/**
 * Utils check bean
 *
 * @param  {Object}   obj object
 * @return {Boolean}  true|false
 * @api public
 */
Utils.checkBean = function(obj) {
	return obj && obj['$id'] &&
		Utils.checkFunction(obj['writeFields']) &&
		Utils.checkFunction(obj['readFields']);
}

Utils.checkNull = function(obj) {
	return !Utils.isNotNull(obj);
}

/**
 * Utils args to array
 *
 * @param  {Object}  args arguments
 * @return {Array}   array
 * @api public
 */
Utils.to_array = function(args) {
	var len = args.length;
	var arr = new Array(len);

	for (var i = 0; i < len; i++) {
		arr[i] = args[i];
	}

	return arr;
}

/**
 * Utils check is not null
 *
 * @param  {Object}   value
 * @return {Boolean}  true|false
 * @api public
 */
Utils.isNotNull = function(value) {
	if (value !== null && typeof value !== 'undefined')
		return true;
	return false;
}

Utils.getType = function(object) {
	if (object == null) {
		return 'null';
	}

	if (Buffer.isBuffer(object)) {
		return 'buffer';
	}

	if (Utils.checkArray(object)) {
		return 'array';
	}

	if (Utils.checkFloat(object)) {
		return 'float';
	}

	var type = typeof object;
	if (type === 'undefined') {
		return 'null';
	}

	return type;
}

module.exports = Utils;