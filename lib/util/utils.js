var exp = module.exports;

exp.invokeCallback = function(cb) {
	if(typeof cb === 'function') {
		cb.apply(null, Array.prototype.slice.call(arguments, 1));
	}
};

exp.applyCallback = function(cb, args) {
	if(typeof cb === 'function') {
		cb.apply(null, args);
	}
};

exp.clone = function(obj) {
	var res = {};
	for(var f in obj) {
		if(obj.hasOwnProperty(f)) {
			res[f] = obj[f];
		}
	}
	return res;
}