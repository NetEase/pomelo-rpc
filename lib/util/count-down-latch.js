var exp = module.exports;

/**
 * execute cb when done has been invoked count times.
 * cb()
 */
var CountDownLatch = function(count, cb) {
	this.count = count;
	this.cb = cb;
};

var bpro = CountDownLatch.prototype;

bpro.done = function() {
	if(this.count <= 0) {
		throw new Error('illegal state.');
	}
	
	this.count--;
	if(this.count === 0) {
		this.cb();
	}
};

/**
 * create a count down latch
 */
exp.createCountDownLatch = function(count, cb) {
	if(!count) {
		throw new Error('count should be positive.');
	}
	if(typeof cb !== 'function') {
		throw new Error('cb should be a function.');
	}
	
	return new CountDownLatch(count, cb);
};