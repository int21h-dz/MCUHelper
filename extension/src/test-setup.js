const path = require("path");
const Module = require("module");

const schemaDist = path.join(__dirname, "../../packages/mcu-schema/dist");
const langDist = path.join(__dirname, "../../packages/mcu-language/dist");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "@mcuhelper/mcu-schema") return path.join(schemaDist, "index.js");
  if (request === "@mcuhelper/mcu-language") return path.join(langDist, "index.js");
  if (request === "vscode") return path.join(__dirname, "vscode-mock.js");
  return origResolve.call(this, request, parent, isMain, options);
};
