# symbolicate
node.js program to symbolicate KSCrash JSON styled iOS crash reports. 

##symbolicate.js 
The primary symbolication engine. This can be used from other node js programs. 

##symbolicate-cli.js 
The CLI way of symbolication.

<b>Usage:</b> node symbolicate-cli.js --dsym crash.dsym --crash crash.json {<optional> --out result.json>}

##On linux
By default the system symbols are looked at /opt/xcode. You can change this path in symbolicate.js.
Copy XCode/iOS DeviceSupport/* to /opt/xcode on linux

Also you should use a atosl tool from https://github.com/facebookarchive/atosl
See http://stackoverflow.com/a/22938643 for setup.

Note that only the following paths are used during symbolication. So to preserve space optionally you can copy only the following
  XCode/iOS DeviceSupport/?/Symbols/System/Library/Frameworks 
  XCode/iOS DeviceSupport/?/Symbols/usr/lib
