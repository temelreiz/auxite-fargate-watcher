"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.err = exports.warn = exports.log = void 0;
const log = (...args) => console.log(new Date().toISOString(), ...args);
exports.log = log;
const warn = (...args) => console.warn(new Date().toISOString(), "[WARN]", ...args);
exports.warn = warn;
const err = (...args) => console.error(new Date().toISOString(), "[ERR] ", ...args);
exports.err = err;
