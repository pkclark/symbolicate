/*******************************************************************
The symbolication engine. 
*******************************************************************/

var strict  = false;
var verbose = false;

var fs 		= require('fs'),
	_  		= require('underscore'),
	S       = require('string'),
	path 	= require('path'),
 	exec 	= require('child_process').exec,
 	async	= require('async'),
 	NumberConverter = require('number-converter').NumberConverter,
 	nc 		= new NumberConverter(NumberConverter.DECIMAL, NumberConverter.HEXADECIMAL),
    timer = require('metrics-timer');
    
/*
Symbolicates a JSON crash report. 
dSYMPath: The dSYM file path.
report: The JSON crash report
cb: callback(err, symbolicatedReport)
*/
var symbolicateCrashReport = function(dSYMPath, report, cb) {
	var metaInfo = {
         'dSYMPath': dSYMPath,
         'process_name': report.system.process_name,
         'cpu_arch': report.system.cpu_arch,
         'os_version': report.system.os_version,
         'system_version': report.system.system_version 
    };

    /*
    We go through each thread and create a dictionary of image name and all occurences of instruction symbols. 
    images = {
        "CoreFoundation": { "symbols": {572056299: <name1>, 52205789: <name1>, ...}, 
                            "object_addr": 571052032,
                            "symbol_addr": 572056172,
                            "object_name": "CoreFoundation" },
        "UIKit": {...}, 
        ...
    }
    */
    var images = {};
	_.each(report.crash.threads, function(thread) {
        var stackTrace = thread.backtrace.contents;
        _.each(stackTrace, function(element) {
            var entry = images[element.object_name];
            if (_.isEmpty(entry))
                entry = _.extend({'symbols': {}}, _.omit(element, 'instruction_addr','symbol_name'));
            entry.symbols[element.instruction_addr] = element.symbol_name;
            images[element.object_name] = entry;
        });
	});

    symbolicateImages(metaInfo, images, function(err, names) {
        if (err) {
            cb(err);
        } else {
            cb(null, updateReportWithSymbolicatedNames(report, names));    
        }
    }); 
}

var symbolicateImages = function(metaInfo, images, cb) {
    var tasks = [];
    _.each(images, function(entry, key) {
        tasks.push(function(cb) { 
            symbolicateEntry(metaInfo, entry, function(err, entry) {
                cb(err, entry);
            }) 
        });
    });
    
    async.series(tasks, function(err, results) {
        if (err) {
            cb(err);
        } else {
            // results is an array of dictionary with symbols key containing <hexaddr:symbolicatedname>
            var names = {};
            _.each(results, function(item) { 
                _.extend(names, item.symbols) 
            });
            cb(null, names);
        }
    });
}

var updateReportWithSymbolicatedNames = function(report, names) {
    report.crash.threads =
    _.map(report.crash.threads, function(thread) {
        var symbolicatedContents = _.map(thread.backtrace.contents, function(entry) {
            var instructionAddrHex = nc.convert(entry.instruction_addr);
            entry.symbol_name = names[instructionAddrHex];
            entry.instruction_addr = instructionAddrHex;
            entry.object_addr = nc.convert(entry.object_addr);
            entry.symbol_addr = nc.convert(entry.symbol_addr);
            return entry;
        });
        thread.backtrace.contents = symbolicatedContents;
        return thread;
    });
    return report;
}

/*
Structure of entry is

{ "symbols": {572056299: <name1>, 52205789: <name1>, ...}, 
                            "object_addr": 571052032,
                            "symbol_addr": 572056172,
                            "object_name": "CoreFoundation" }
                            
Result is that every symbol is symbolicated and the corresponding name is replaced.  
*/
var symbolicateEntry = function(metaInfo, entry, cb) {
	var isMac = (process.platform === 'darwin');
	var ATOS_TOOL 		= isMac?'atos':'atosl',
		DEV_SUPP_PATH	= isMac?'~/Library/Developer/Xcode/iOS\ DeviceSupport':'/opt/xcode',
		SYS_FW_PATH 	= '/Symbols/System/Library/Frameworks',
		SYS_DYLIB_PATH  = '/Symbols/usr/lib/system/';

	// Ex: atos -o xyz.dSYM -arch arm64 -l 0x26312000 0x2638dfb4
	var cmdTemplate;
	if(isMac) cmdTemplate = "{{ATOS_TOOL}} -o {{SYM_FILE}} -arch {{ARCH}} -l {{OBJECT_ADDR}} {{INSTRUCTION_ADDR}}";
	else cmdTemplate = "{{ATOS_TOOL}} -o {{SYM_FILE}} --arch {{ARCH}} -l {{OBJECT_ADDR}} {{INSTRUCTION_ADDR}}";
	// Ex: ~/Library/Developer/Xcode/iOS\ DeviceSupport/9.2.1\ \(13D15\)
	var systemSymbolsPath = S("{{SYS_VER}} \\({{OS_VER}}\\)").template({'SYS_VER': metaInfo.system_version, 
																'OS_VER': metaInfo.os_version}).s;  
	var nonProcessSymFile = path.join(DEV_SUPP_PATH, systemSymbolsPath).replace(/ /g, '\\ ');

    var hexSymbols = {}, 
        toSymbolicate = [],
        object_name = entry.object_name;
    _.each(entry.symbols, function(name, decimalAddr) {
        var hex = nc.convert(decimalAddr);
        hexSymbols[hex] = name;
        toSymbolicate.push(hex);
    })
    // TODO: If symbol name exists then skip from symbolication.
    entry.symbols = hexSymbols;
    entry.object_addr = nc.convert(entry.object_addr);
    entry.symbol_addr = nc.convert(entry.symbol_addr);
    
    var values = {};
	if (object_name === metaInfo.process_name) {
		values = {
            'ATOS_TOOL': ATOS_TOOL,
            'SYM_FILE' : metaInfo.dSYMPath,
            'ARCH'	   : ((metaInfo.cpu_arch === 'armv7s')?'armv7':metaInfo.cpu_arch),
            'OBJECT_ADDR': entry.object_addr,
            'INSTRUCTION_ADDR': toSymbolicate.join(' ')
        };
	} else if (S(object_name).endsWith('dylib')) {
		// TODO: Check in ../SYS_DYLIB_PATH as well for libs like sqlite
        values = {
            'ATOS_TOOL': ATOS_TOOL,
            'SYM_FILE' : path.join(nonProcessSymFile, SYS_DYLIB_PATH, entry.object_name),
            'ARCH'	   : ((metaInfo.cpu_arch === 'armv7')?'armv7s':metaInfo.cpu_arch),
            'OBJECT_ADDR': entry.object_addr,
            'INSTRUCTION_ADDR': toSymbolicate.join(' ')
        };
	} else {        
        // TODO: When not found check in PrivateFrameworks folder also. 
        values = {
            'ATOS_TOOL': ATOS_TOOL,
            // Ex: <nonProcessSymFile>/System/Library/Frameworks/UIKit.framework/UIKit 
            'SYM_FILE' : path.join(nonProcessSymFile, SYS_FW_PATH, entry.object_name+'.framework', entry.object_name),
            'ARCH'	   : ((metaInfo.cpu_arch === 'armv7')?'armv7s':metaInfo.cpu_arch),
            'OBJECT_ADDR': entry.object_addr,
            'INSTRUCTION_ADDR': toSymbolicate.join(' ')
        };
	}
 
	var cmd = S(cmdTemplate).template(values).s;
	exec(cmd, function(err, stdout, stderr) {
        if (err) {
            if (verbose) console.log('***error:'+cmd+':'+stderr);
        	if (strict) cb(err); 
            else cb(null, entry); 
        } else {
            if (_.isEmpty(stdout)) {
                if (strict) cb(new Error("Empty result from "+cmd));
                else cb(null, entry);
            } else {
                var names = S(S(stdout).trim().s).lines();
                var symbolNames = _.object(toSymbolicate, names);
                entry.symbols = symbolNames;
                cb(null, entry);
            }
    	}
    });
}

var _prettyPrint = function(obj, title) {
    console.log(((title)?(title):'')+'\n'+JSON.stringify(obj, null, 2))
}

module.exports = {
	'strict': strict,
	'symbolicateCrashReport': symbolicateCrashReport
}

// TODO: Add job logging support.
// eof