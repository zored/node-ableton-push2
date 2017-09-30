var easymidi = require('easymidi');
var push2keymap = require('./Push2Keymap');
var EventEmitter = require('events').EventEmitter;

class Midi extends EventEmitter {
  constructor(portName='Ableton Push 2 User Port',virtual=false){
    super();
    console.log(`Initializing ${portName}`);
    this._input = new easymidi.Input(portName,virtual);
    this._output = new easymidi.Output(portName,virtual);
    this._input.on('message',(msg)=>{
      // Emit all messages as 'message' events, plus each individual type separately.
      this.emit(msg._type,msg);
      this.emit('message',msg);
    });
  }
  send(messageType,message){
    this._output.send(messageType,message);
  }
  removeAllListeners(){
    this._input.removeAllListeners();
  }
  close() {
    this._input.close();
    this._output.close();
  }
}
function bit7array2dec(bit7array){
  // Decodes an array of 7-bit values ordered from LSB to MSB.
  var dec = 0;
  bit7array.forEach((v,i)=> dec |= v << (i*7) );
  return dec;
}
function dec2bit7array(num){
  // Encodes a number as an array of 7-bit numbers from LSB to MSB.
  if (num < 0 || typeof num != 'number') throw new Error("Only positive numbers supported.");
  var p =  Math.floor(num.toString(2).length/7);
  var res = [];
  while (p>=0){
    res.push((num >> p*7)&0x7f);
    p -= 1;
  }
  return res.reverse();
}

// Touch Strip Configuration Flags
//   ---------------
// bit |6|5|4|3|2|1|0|
//   ---------------                       |   0         |   1
//      | | | | | | |  --------------------+-------------+----------
//      | | | | | | --- LEDs Controlled By | Push 2*     | Host
//      | | | | | ----- Host Sends         | Values*     | Sysex
//      | | | | ------- Values Sent As     | Pitch Bend* | Mod Wheel
//      | | | --------- LEDs Show          | a Bar       | a Point*
//      | | ----------- Bar Starts At      | Bottom*     | Center
//      | ------------- Do Autoreturn      | No          | Yes*
//      --------------- Autoreturn To      | Bottom      | Center*
//
// *) The default settings are marked in bold.
//
// https://github.com/Ableton/push-interface/blob/master/doc/AbletonPush2MIDIDisplayInterface.asc#210-touch-strip
class TouchStripConfiguration {
  constructor(val){
    // can be instantiated with either a 7-bit valber to be decoded, or
    // val can be an object with options to be merged with defaults.
    var defaults = this._parseNum(null);
    this.props=[ 'LEDsControlledByPushOrHost',
      'hostSendsValuesOrSysex',
      'valuesSentAsPitchBendOrModWheel',
      'LEDsShowBarOrPoint',
      'barStartsAtBottomOrCenter',
      'doAutoReturnNoOrYes',
      'autoReturnToBottomOrCenter',
    ];
    this.props.forEach((prop)=>this[prop]=defaults[prop]);
    if (typeof val == 'undefined'){ // get defaults if no options are provided.
      defaults = this._parseNum(null);
    } else if (typeof val == 'object') {
      defaults = val;
    } else if (typeof val == 'number') { // parse and then set properties
      defaults = this._parseNum(val);
    }
    this.props.forEach((key)=>{
      this[key] = defaults[key];
    });
  }
  getByteCode(){
    var res = 0;
    this.props.forEach((key,i)=>{
      res |= this[key]<<(i);
    });
    return res;
  }
  _parseNum(num=null){
    // if num is null, will return default options
    return {
      autoReturnToBottomOrCenter: (num != null)? (num>>6)%2 : 1,  // default: autoreturn to center
      doAutoReturnNoOrYes: (num != null)? (num>>5)%2 : 1, // default: do autoreturn = true
      barStartsAtBottomOrCenter: (num != null)? (num>>4)%2 : 0, // default: bar starts at bottom
      LEDsShowBarOrPoint: (num != null)? (num>>3)%2 : 1, // default: LEDs show point
      valuesSentAsPitchBendOrModWheel: (num != null)? (num>>2)%2 : 0, // dafault: values sent as pitch bend
      hostSendsValuesOrSysex: (num != null)? (num>>1)%2 : 0, // default: Host sends values (ignored if LEDsControlledByPushOrHost==1)
      LEDsControlledByPushOrHost: (num != null)? (num)%2 : 0, // default: Push 2 controls touch strip LEDs
    };
  }
}
class DeviceIdentity {
  constructor(msg){
    this.firmwareVersion = msg[12]+'.'+msg[13];
    // Parse serial number
    this.serialNumber = bit7array2dec(msg.slice(16,21));
    // parse build number
    this.softwareBuild = bit7array2dec(msg.slice(14,16));
    // device family code
    this.deviceFamilyCode = bit7array2dec(msg.slice(8,10));
    // device family member code
    this.deviceFamilyMemberCode = bit7array2dec(msg.slice(10,12));
    this.boardRevision = msg[21];
  }
}


module.exports = {
  Push2:class Push2 extends EventEmitter {
    constructor(port='user',virtual=false){
      super();
      this._virtual = virtual;
      this.deviceIdentity = null;
      this.touchStripConfiguration = null;
      port = port.toLowerCase();
      if (port !='live' && port != 'user') throw new Error("Expected port to be either 'user' or 'live'.");
      port = port[0].toUpperCase() + port.slice(1); // Capitalize the first letter
      this.portName = `Ableton Push 2 ${port} Port`;
      this.midi = new Midi(this.portName,virtual);
      // this.getDeviceInfo();
      // this.getTouchStripConfiguration();
    }
    monitor(){
      var portName = this.portName;
      this.midi.on('message', this._printMessage.bind(this));
    }
    stopMonitor(){
      this.midi.removeListener('message', this._printMessage.bind(this));
    }
    close(){
      this.midi.close();
    }
    setColor(key,paletteIdx) {
      // key: key name from push2keymap
      // pad can also be an array containing [track,scene] with values [[1-8],[1-8]]
      // paletteIdx: color palette index [1-127]
      var keyIndex = null;
      var keyName = "";
      //if (typeof key == 'number') keyIndex=key;
      if (typeof key == 'string') { // must be a key name
        keyIndex = push2keymap.controlsByName[key];
        if (keyIndex==null) keyIndex = push2keymap.keysByName[key];
        keyName = key;
      } else if (typeof key == 'object') { // must be an array [track,scene]
        keyName = `pad ${key[0]},${key[1]}`;
        keyIndex = push2keymap.keysByName[keyName];
      }
      if (keyIndex == null) throw `${keyName} not found.`;
      console.log(`Setting color of ${keyName} (${keyIndex}) to ${paletteIdx}`);
      if (keyName.slice(0,4)=="pad ") { // Must be for a pad control, use noteon
        this.midi.send('noteon', {
          note: keyIndex,
          velocity: paletteIdx,
        });
      } else { // Must be a button, use cc
        this.midi.send('cc', {
          controller: keyIndex,
          value: paletteIdx,
        });
      }
    }
    getDeviceInfo(){
      var self = this;
      return new Promise(function (resolve, reject) {
        self.midi.on('sysex',function handler(msg) {
          if (msg.bytes[4]==2) { // device identity reply
            self.midi.removeListener('sysex',handler);
            self.deviceIdentity = new DeviceIdentity(msg.bytes);
            self.emit('received_deviceIdentity',self.deviceIdentity);
            resolve(self.deviceIdentity);
          }
        });
        self.midi.send('sysex',[240, 126, 1, 6, 1, 247]);
        setTimeout(()=>{ // reject if no usable response after 1 second.
          reject(new Error("No device inquiry reponse received."));
        },1000);
      });
    }
    getTouchStripConfiguration() {
      return new Promise((resolve,reject)=>{
        this._sendSysexRequest([0x18]).then((resp)=>{
          this.touchStripConfiguration = new TouchStripConfiguration(resp.bytes[7]);
          this.emit('received_touchStripConfiguration',this.touchStripConfiguration);
          resolve(this.touchStripConfiguration);
        }).catch(reject);
      });
    }
    setTouchStripConfiguration(val){
      return new Promise((resolve,reject)=>{
        var sendCommand = (encoded)=>{
          var conf = new TouchStripConfiguration(encoded);
          console.log("Setting touch strip configuration to:",conf);
          this._sendSysexCommand([0x17,encoded]);
          resolve(conf);
        };
        if (typeof val == 'object') {
          // If an object is provided, will first get current config and then merge in options.
          this.getTouchStripConfiguration().then((conf)=>{
            conf.props.forEach((key)=> {
              if (typeof val[key]!='undefined') conf[key]=val[key];
            });
            sendCommand(conf.getByteCode());
          });
        } else if (typeof val == 'number') {
          sendCommand(val);
        }
        else reject(new Error("Expected val to be either a number or an object."));
      });
    }
    getDisplayBrightness(){
      var self = this;
      return new Promise((resolve,reject)=>{
        self._sendSysexRequest([9]).then((resp)=>{
          resolve(bit7array2dec(resp.bytes.slice(7,9)));
        }).catch(reject);
      });
    }
    setDisplayBrightness(val){
      // Return a Promise which resolves after verifying that the value was set.
      return new Promise((resolve,reject)=>{
        var req = [0x08];
        dec2bit7array(val).forEach((v)=>req.push(v));
        this._sendSysexCommand(req);
        this.getDisplayBrightness().then((newVal)=>{
          if (newVal == val) resolve();
          else reject(new Error("Tried setting display brightness, but new value doesn't match."));
        }).catch(reject);
      });
    }
    _sendSysexCommand(msg){
      // Adds sysex message header and 0xf7 footer, then sends command.
      //[F0 00 21 1D 01 01 ... ... ... F7];
      var a = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01 ];
      msg.forEach((v)=>a.push(v));
      a.push(0xf7);
      console.log("Sending sysex command:",a);
      this.midi.send('sysex',a);
    }
    _sendSysexRequest(msg){
      // Sends a sysex request and handles response. Throws error if no respone received after 1 second.
      var self = this;
      return new Promise(function (resolve, reject) {
        var commandId = msg[0];
        setTimeout(()=>{ // reject if no usable response after 1 second.
          reject(new Error("No usable sysex reponse message received."));
        },1000);
        self.midi.on('sysex',function handler(resp) {
          if (resp.bytes[6]==commandId){ // This response matches our request.
            self.midi.removeListener('sysex',handler);
            resolve(resp);
          }
        });
        self._sendSysexCommand(msg);
      });
    }
    _printMessage(msg) {
      var buttonName;
      if (Object.keys(msg).includes('note')){
        buttonName = push2keymap.keys[msg.note];
      } else if (Object.keys(msg).includes('controller')){
        buttonName = push2keymap.controls[msg.controller];
      }
      if (msg._type=='noteon'){
        var toPrint = ` ${buttonName} pressed`;
        if (msg.note>=36 && msg.note<=99) toPrint += `, velocity: ${msg.velocity}`;
        console.log(this.portName,toPrint,msg);
      }
      else if (msg._type=='noteoff')
        console.log(this.portName,` ${buttonName} released`,msg);
      else if (msg._type=='poly aftertouch')
        console.log(this.portName,` ${buttonName} pressure change to: ${msg.pressure}`,msg);
      else if (msg._type=='cc')
        console.log(this.portName,` ${buttonName}: ${msg.value}`,msg);
      else if (msg._type=='program')
        console.log(this.portName,` program: ${msg.program}`,msg);
      else if (msg._type=='channel aftertouch')
        console.log(this.portName,` channel pressure change to: ${msg.pressure}`,msg);
      else if (msg._type=='pitch')
        console.log(this.portName,` pitch bend position: ${msg.value}`,msg);
      else if (msg._type=='position')
        console.log(this.portName,` control wheel position: ${msg.value}`,msg);
      else console.log(this.portName,` message not understood: `,msg);
    }
  }
};
