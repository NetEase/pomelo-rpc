var exp = module.exports;

exp.invokeCallback = function(cb) {
  if(typeof cb === 'function') {
    cb.apply(null, Array.prototype.slice.call(arguments, 1),
					Array.prototype.slice.call(arguments, 2));
  }
};

exp.applyCallback = function(cb, args) {
  if(typeof cb === 'function') {
    cb.apply(null, args);
  }
};
