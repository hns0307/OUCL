module.exports.useState = (...args) => globalThis.__hooks.useState(...args);
module.exports.useRef = (...args) => globalThis.__hooks.useRef(...args);
module.exports.useEffect = (...args) => globalThis.__hooks.useEffect(...args);
