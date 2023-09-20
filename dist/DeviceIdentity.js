"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceIdentity = void 0;
const utils_1 = require("./utils");
class DeviceIdentity {
    constructor(bytes) {
        this.firmwareVersion = bytes[12] + '.' + bytes[13];
        // Parse serial number
        this.serialNumber = (0, utils_1.bit7array2dec)(bytes.slice(16, 21));
        // parse build number
        this.softwareBuild = (0, utils_1.bit7array2dec)(bytes.slice(14, 16));
        // device family code
        this.deviceFamilyCode = (0, utils_1.bit7array2dec)(bytes.slice(8, 10));
        // device family member code
        this.deviceFamilyMemberCode = (0, utils_1.bit7array2dec)(bytes.slice(10, 12));
        this.boardRevision = bytes[21];
    }
}
exports.DeviceIdentity = DeviceIdentity;
