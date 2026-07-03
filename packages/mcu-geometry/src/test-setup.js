const path = require("path");
const Module = require("module");

const langDist = path.join(__dirname, "../../mcu-language/dist");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "@mcuhelper/mcu-language") {
    return path.join(langDist, "index.js");
  }
  return origResolve.call(this, request, parent, isMain, options);
};
