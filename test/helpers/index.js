const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");

function loadFixture(name) {
  const file = name.endsWith(".mcu") ? name : `${name}.mcu`;
  return fs.readFileSync(path.join(root, "test", "fixtures", file), "utf8");
}

function loadRuntest(relPath) {
  return fs.readFileSync(path.join(root, "RUNTEST", relPath), "utf8");
}

function createTextDocument(uri, text, languageId = "mcunr", version = 1) {
  const { TextDocument } = require("vscode-languageserver-textdocument");
  return TextDocument.create(uri, languageId, version, text);
}

function analyzeFixture(name, analyzeDocument) {
  const text = loadFixture(name);
  const uri = `file:///fixtures/${name}.mcu`;
  return analyzeDocument(uri, text, 1);
}

module.exports = {
  loadFixture,
  loadRuntest,
  createTextDocument,
  analyzeFixture,
  root,
};
