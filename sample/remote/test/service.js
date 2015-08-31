// remote service

module.exports = function(context) {
	return {
		echo: function(msg, cb) {
			// setTimeout(function() {
				cb(null, msg);
			// }, 1000);
		}
	};
};