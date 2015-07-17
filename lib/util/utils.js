var exp = module.exports;

exp.invokeCallback = function(cb) {
	if (typeof cb === 'function') {
		cb.apply(null, Array.prototype.slice.call(arguments, 1));
	}
};

exp.applyCallback = function(cb, args) {
	if (typeof cb === 'function') {
		cb.apply(null, args);
	}
};

exp.getObjectClass = function(obj) {
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