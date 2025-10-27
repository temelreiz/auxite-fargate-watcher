export const log = (...args) => console.log(new Date().toISOString(), ...args);
export const warn = (...args) => console.warn(new Date().toISOString(), "[WARN]", ...args);
export const err = (...args) => console.error(new Date().toISOString(), "[ERR] ", ...args);
