import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import { getCompletions } from "./completion";
import { collectDiagnostics } from "./serverHandlers";

const WARMUP_URI = "mcuhelper-internal://warmup";
const WARMUP_TEXT = "PIN 1 0\nMATR 1\nU235 1.0\nHEAD 3 0\n";

/** Прогрев JIT/модулей до первого ввода пользователя (completion, diagnostics). */
export function warmupLanguageServer(): void {
  try {
    const doc = TextDocument.create(WARMUP_URI, "mcunr", 1, WARMUP_TEXT);
    const index = analyzeDocument(WARMUP_URI, WARMUP_TEXT, 1, { expandInclude: false });
    getCompletions(doc, { line: 0, character: 1 }, index);
    collectDiagnostics(doc);
  } catch {
    // ignore warmup errors
  }
}
