/** Minimal vscode API mock for unit tests outside VS Code host. */
class MarkdownString {
  constructor(value) {
    this.value = value;
    this.isTrusted = undefined;
    this.supportThemeIcons = false;
  }
}

module.exports = {
  MarkdownString,
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, defaultValue) => defaultValue,
    }),
  },
  languages: {
    setTextDocumentLanguage: async () => undefined,
  },
  commands: {
    registerCommand: () => ({ dispose: () => undefined }),
  },
  window: {
    showErrorMessage: async () => undefined,
    activeTextEditor: undefined,
    createTextEditorDecorationType: () => ({ dispose: () => undefined }),
  },
  Uri: {
    parse: (s) => ({ toString: () => s, fsPath: s.replace("file://", "") }),
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class Diagnostic {
    constructor(range, message, severity = 0) {
      this.range = range;
      this.message = message;
      this.severity = severity;
      this.source = undefined;
      this.code = undefined;
    }
  },
  Range: class Range {
    constructor(startLine, startChar, endLine, endChar) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  },
  DecorationRangeBehavior: { ClosedClosed: 1, ClosedOpen: 2, OpenClosed: 3, OpenOpen: 0 },
  ExtensionContext: class {},
};
