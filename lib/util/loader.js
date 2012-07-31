var fs = require('fs');
var path = require('path');

/**
 * Load modules under the path.
 * If the module is a function, we would treat it as a factory function 
 * and invoke it with the context parameter to get a instance of the module.
 * Else we would just require the module.
 * 
 * @param mpath {String} the path of modules. Load all the files under the path, but *not* 
 *		recursively if the path is a directory. And load the index.js instead if any 
 *		index.js under the path.
 * @param context {Object} the context parameter that would be pass to the module factory
 *		function.
 * @param loadedCB {Function} callback function for loaded module. It is a chance to modify 
 *		the module from outside (eg: create proxy). Function declaration: loadCB(path, module), 
 *		the return value would replace the origin module instance.
 * @return {Object} module that has loaded.
 */
module.exports.load = function(mpath, context, loadedCB) {
	if(!mpath) {
		throw new Error('opts or opts.path should not be empty.');
	}

	if(path.existsSync(mpath)) {
		throw new Error('path not exist, path:' + mpath);
	}

	mpath = fs.realpathSync(mpath);

	if(!isDir(mpath)) {
		throw new Error('path should be directory.');
	}

	return loadPath(mpath, context);
};

var loadFile = function(fp, context) {
	var m = require(fp);

	if(!m) {
		return;
	}

	if(typeof m === 'function') {
		// if the module provides a factory function 
		// then invoke it to get a instance
		m = m(context);
	}

	return m;
};

var loadPath = function(path, context, loadedCB) {
	var files = fs.readdirSync(path);
	if(files.length === 0) {
		console.warn('path is empty, path:' + path);
		return;
	}

	if(path.charAt(path.length - 1) !== '/') {
		path += '/';
	}
		
	var fp, fn, m, res = {};
	for(var i=0, l=files.length; i<l; i++) {
		fn = files[i];
		fp = path + fn;
		
		if(!isFile(fp) || !checkFileType(fn, '.js')) {
			// only load js file type
			continue;
		}
		
		m = loadFile(fp, context, loadedCB);
		
		if(!m) {
			continue;
		}

		var name = m.name || getFileName(fn, '.js'.length);

		if(!loadedCB && typeof loadedCB === 'function') {
			m = loadedCB(path, name, m);
		}
		
		res[name] = m;
	}
	
	return res;
};

/**
 * Check file suffix

 * @param fn {String} file name
 * @param suffix {String} suffix string, such as .js, etc.
 */
var checkFileType = function(fn, suffix) {
	if(suffix.charAt(0) !== '.') {
		suffix = '.' + suffix;
	}
	
	if(fn.length <= suffix.length) {
		return false;
	}
	
	var str = fn.substring(fn.length - suffix.length).toLowerCase();
	suffix = suffix.toLowerCase();
	return str === suffix;
};

var isFile = function(path) {
	return fs.statSync(path).isFile();
};

var isDir = function(path) {
	return fs.statSync(path).isDirectory();
};

var getFileName = function(fp, suffixLength) {
	var fn = path.basename(fp);
	if(fn.length > suffixLength) {
		return fn.substring(0, fn.length - suffixLength);
	}

	return fn;
};