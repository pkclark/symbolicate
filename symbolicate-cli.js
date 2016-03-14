/******************************************************************
The symbolication process from CLI. 
This inturn uses symbolicate.js which performs the symbolication.
*******************************************************************/

var	_  			= require('underscore'),
	fs 			= require('fs'),
	yargs		= require('yargs').argv,
	colors		= require('colors'),
	cliff		= require('cliff');
	symbolicate = require('./symbolicate.js') 

var start = function() {
	var crashFile = yargs['crash'];
	var dSYMFile = yargs['dsym'];
	var output = yargs['out'];

	if (_.isEmpty(crashFile)|| _.isEmpty(dSYMFile)) {
		console.log('Usage: node symbolicate-cli.js --dsym crash.dsym --crash crash.json {<optional> --out result.json>}');
		return;
	}

	fs.readFile(crashFile, 'utf8', function (err, data) {
		console.log('Symbolicating ...');
		symbolicate.symbolicateCrashReport(dSYMFile, JSON.parse(data), function(err, symbolicatedReport) {
			if (err) {
				throw err;
			} else {
				if (output) {
					fs.writeFile(output, JSON.stringify(symbolicatedReport, null, 2) , 'utf-8');
					console.log(colors.white('output written to '+output));
				} else {
				    prettyPrintReport(symbolicatedReport);
                }
			}
		});
	});
};

var prettyPrintReport = function(report) {
	var error = report.crash.error;
	console.log(colors.white.bold('Reason: '+error.reason));
    _.each(report.crash.threads, function(thread) {
        prettyPrintBacktrace(thread);    
    });    
}

var prettyPrintBacktrace = function(thread) {
    console.log(colors.white.bold('\nThread '+thread.index));
    console.log(cliff.stringifyObjectRows(thread.backtrace.contents, ['object_name', 'instruction_addr', 'symbol_name'],
                                                             ['yellow', 'yellow', 'yellow']));
}

start();

// eof