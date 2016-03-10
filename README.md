# symbolicate
node.js program to symbolicate KSCrash JSON styled iOS crash reports. 

##symbolicate.js 
The primary symbolication engine. This can be used from other node js programs. 

##symbolicate-cli.js 
The CLI way of symbolication.

<b>Usage:</b> node symbolicate-cli.js --dsym crash.dsym --crash crash.json {<optional> --out result.json>}
