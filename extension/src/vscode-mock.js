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
  },
  Uri: {
    parse: (s) => ({ toString: () => s, fsPath: s.replace("file://", "") }),
  },
  ExtensionContext: class {},
};
