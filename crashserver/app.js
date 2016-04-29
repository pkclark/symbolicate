var express = require('express');
var path = require('path');
var bodyParser = require('body-parser');
var fs 		= require('fs');
var _ = require('underscore');
var	colors		= require('colors');
var	cliff		= require('cliff');
var symbolicator = require('../symbolicate.js');

var app = express();
var LISTEN_PORT = 3000;

// IMPORTANT: Change this path to reflect the correct dSYM file. 
var dSYMPath = '../sample/crash.dsym';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/crashreports', function(req, res, next) {
    var dir = './tmp';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
    }
    var fname = _.now()+'.json';
    var input = 'tmp/input_'+fname;
    var output = 'tmp/output_'+fname;
    console.log('Received crash report saved at'+input);
    fs.writeFile(input, JSON.stringify(req.body, null, 2) , 'utf-8');
    
    console.log('Symbolicating...');
    // Take the expected part of JSON from input and send to symbolication.
    symbolicator.symbolicateCrashReport(dSYMPath, req.body.stack, function(err, symbolicatedReport) {
        if (err) {
            console.log(err);
        } else {
            prettyPrintReport(symbolicatedReport);
            fs.writeFile(output, JSON.stringify(symbolicatedReport, null, 2) , 'utf-8');        
            console.log('Symbolicated report saved at '+output);
        }
        res.send('ok');
    });    
}) 

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

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
});

module.exports = app;

app.listen(LISTEN_PORT, function() {
  console.log('Using dSYM file: '+dSYMPath);
  console.log('Crash your app and POST to http://localhost:'+LISTEN_PORT+'/crashreports');
});

