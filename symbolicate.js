var strict  = true;
var fs 		= require('fs'),
	_  		= require('underscore'),
	S       = require('string'),
	path 	= require('path'),
 	exec 	= require('child_process').exec,
 	async	= require('async'),
 	cliff	= require('cliff'),
 	colors	= require('colors'),
 	yargs	= require('yargs').argv,
 	NumberConverter = require('number-converter').NumberConverter,
 	nc 		= new NumberConverter(NumberConverter.DECIMAL, NumberConverter.HEXADECIMAL);

var ATOS_TOOL 		= 'atos',
	DEV_SUPP_PATH	= '~/Library/Developer/Xcode/iOS\ DeviceSupport',
	SYS_FW_PATH 	= '/Symbols/System/Library/Frameworks',
	SYS_DYLIB_PATH  = '/Symbols/usr/lib/system/';

var processCrashReport = function(dSYM, report, cb) {
	var metaInfo = {
					 'dSYM': dSYM,
					 'process_name': report.system.process_name,
					 'cpu_arch': report.system.cpu_arch,
					 'os_version': report.system.os_version,
				 	 'system_version': report.system.system_version 
				 	};

	_.each(report.crash.threads, function(thread) {
		if (thread.crashed) {
			var stackTrace = thread.backtrace.contents;
			symbolicateStackTrace(metaInfo, stackTrace, function(err, results) {
				if (err) {
					cb(err);
				} else {
					report.crash.threads[thread.index].backtrace.contents = results;
					cb(null, report);
				}		
			});	
		}
	});				 	
	// var stacktrace = report.crash.threads[0].backtrace.contents;
	// symbolicateStackTrace(metaInfo, stacktrace, function() {});	
}

var symbolicateStackTrace = function(metaInfo, stackTrace, cb) {
	var tasks = [];
	_.each(stackTrace, function(element, index) {
		tasks.push(function(callback) {
			symbolicateEntry(metaInfo, element, callback);
		});
	});
	async.series(tasks, function(err, results) {
		cb(err, results);
	});
}

var symbolicateEntry = function(metaInfo, entry, cb) {
	// Ex: atos -o xyz.dSYM -arch arm64 -l 0x26312000 0x2638dfb4
	var cmdTemplate = "{{ATOS_TOOL}} -o {{SYM_FILE}} -arch {{ARCH}} -l {{OBJECT_ADDR}} {{INSTRUCTION_ADDR}}";
	var object_name = entry.object_name;
	var values = {};

	// Ex: ~/Library/Developer/Xcode/iOS\ DeviceSupport/9.2.1\ \(13D15\)
	var systemSymbolsPath = S("{{SYS_VER}} \\({{OS_VER}}\\)").template({'SYS_VER': metaInfo.system_version, 
																'OS_VER': metaInfo.os_version}).s;  
	var nonProcessSymFile = path.join(DEV_SUPP_PATH, systemSymbolsPath).replace(/ /g, '\\ ');

	if (object_name === metaInfo.process_name) {
		//console.log('process sym');
		values = {
					'ATOS_TOOL': ATOS_TOOL,
					'SYM_FILE' : metaInfo.dSYM,
					'ARCH'	   : ((metaInfo.cpu_arch === 'armv7s')?'armv7':metaInfo.cpu_arch),
					'OBJECT_ADDR': nc.convert(entry.object_addr),
					'INSTRUCTION_ADDR': nc.convert(entry.instruction_addr)
				 };

	} else if (S(object_name).endsWith('dylib')) {
		// TODO: Check in ../SYS_DYLIB_PATH as well for libs like sqlite
		if (entry.symbol_name === '<redacted>') {
			values = {
				'ATOS_TOOL': ATOS_TOOL,
				'SYM_FILE' : path.join(nonProcessSymFile, SYS_DYLIB_PATH, entry.object_name),
				'ARCH'	   : ((metaInfo.cpu_arch === 'armv7')?'armv7s':metaInfo.cpu_arch),
				'OBJECT_ADDR': nc.convert(entry.object_addr),
				'INSTRUCTION_ADDR': nc.convert(entry.instruction_addr)
     		};
		} else {
			cb(null, entry);
			return;
		}
	} else {
		if (entry.symbol_name === '<redacted>') {
			values = {
				'ATOS_TOOL': ATOS_TOOL,
				// <nonProcessSymFile>/System/Library/Frameworks/UIKit.framework/UIKit 
				'SYM_FILE' : path.join(nonProcessSymFile, SYS_FW_PATH, entry.object_name+'.framework', entry.object_name),
				'ARCH'	   : ((metaInfo.cpu_arch === 'armv7')?'armv7s':metaInfo.cpu_arch),
				'OBJECT_ADDR': nc.convert(entry.object_addr),
				'INSTRUCTION_ADDR': nc.convert(entry.instruction_addr)
			};
		} else {
			cb(null, entry);
			return;
		}
	}

	var cmd = S(cmdTemplate).template(values).s;
	var child = exec(cmd, function(err, stdout, stderr) {
        if (err) {
        	if (strict) {
        		cb(err)
        	} else {
        		console.log(err);
        		cb(null, entry);
        	}
        } else {
        	entry.symbol_name = S(stdout).trim().s;
        	cb(null, entry);
    	}
    });
}

var start = function() {
	var crashFile = yargs['crash'];
	var dSYMFile = yargs['dsym'];
	if (_.isEmpty(crashFile)|| _.isEmpty(dSYMFile)) {
		console.log('Usage: node symbolicate.js --dsym crash.dsym --crash crash.json');
		return;
	}

	fs.readFile(crashFile, 'utf8', function (err, data) {
		console.log('Symbolicating ...');
		processCrashReport(dSYMFile, JSON.parse(data), function(err, report) {
			if (err) {
				throw err;
			} else {
				prettyPrintReport(report);
			}
		});
	});
};

var prettyPrintReport = function(report) {
	var error = report.crash.error;
	console.log(colors.red.bold('Reason: ') + colors.white(error.reason));
	var crashedThread = _.findWhere(report.crash.threads, {crashed: true});
	prettyPrintStackTrace(crashedThread.backtrace.contents);
}

var prettyPrintStackTrace = function(stackTrace) {
	 console.log(cliff.stringifyObjectRows(stackTrace, ['object_name', 'instruction_addr', 'symbol_name'],['yellow', 'yellow', 'yellow']));
}

start();