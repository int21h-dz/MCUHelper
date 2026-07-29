import * as vscode from "vscode";
import {
  isLanguageDetectCandidate,
  maybeSetMcunrLanguage,
  scoreMcunrContent,
  type McunrDetectionResult,
} from "./contentDetect";

const DEBOUNCE_MS = 600;
const MAX_ATTEMPTS = 5;
/** Длина документа, при которой score=0 считается окончательным отказом. */
const GIVE_UP_LENGTH = 500;

interface DocDetectState {
  timer?: ReturnType<typeof setTimeout>;
  attempts: number;
  done: boolean;
  pendingPaste?: string;
}

const states = new Map<string, DocDetectState>();

function uriKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

function getState(key: string): DocDetectState {
  let state = states.get(key);
  if (!state) {
    state = { attempts: 0, done: false };
    states.set(key, state);
  }
  return state;
}

/** Стоит ли прекратить попытки автоопределения (чистая логика для тестов). */
export function shouldStopLanguageDetect(
  attempts: number,
  result: McunrDetectionResult,
  docLength: number,
  succeeded: boolean
): boolean {
  if (succeeded) return true;
  if (result.score === 0 && docLength > GIVE_UP_LENGTH) return true;
  return attempts >= MAX_ATTEMPTS;
}

function collectInsertedText(changes: readonly vscode.TextDocumentContentChangeEvent[]): string {
  let pasted = "";
  for (const change of changes) {
    if (change.text.length > 0) pasted += change.text;
  }
  return pasted;
}

async function runDetectAttempt(
  doc: vscode.TextDocument,
  state: DocDetectState,
  log?: vscode.OutputChannel
): Promise<void> {
  if (state.done || !isLanguageDetectCandidate(doc)) return;

  const pasted = state.pendingPaste ?? "";
  state.pendingPaste = undefined;

  let succeeded = false;
  if (pasted && scoreMcunrContent(pasted).isMcunr) {
    succeeded = await maybeSetMcunrLanguage(doc, log);
  } else {
    succeeded = await maybeSetMcunrLanguage(doc, log);
  }

  const result = scoreMcunrContent(doc.getText());
  state.attempts += 1;

  if (shouldStopLanguageDetect(state.attempts, result, doc.getText().length, succeeded)) {
    state.done = true;
  }
}

/** Debounced-детект при правке plaintext/ini (копипаст и постепенный набор). */
export function scheduleLanguageDetectOnEdit(
  doc: vscode.TextDocument,
  changes: readonly vscode.TextDocumentContentChangeEvent[],
  log?: vscode.OutputChannel
): void {
  if (!isLanguageDetectCandidate(doc)) return;

  const inserted = collectInsertedText(changes);
  if (!inserted) return;

  const key = uriKey(doc);
  const state = getState(key);
  if (state.done || state.attempts >= MAX_ATTEMPTS) return;

  state.pendingPaste = (state.pendingPaste ?? "") + inserted;

  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void runDetectAttempt(doc, state, log);
  }, DEBOUNCE_MS);
}

/** Очистить состояние при закрытии документа. */
export function clearLanguageDetectState(doc: vscode.TextDocument): void {
  const key = uriKey(doc);
  const state = states.get(key);
  if (state?.timer) clearTimeout(state.timer);
  states.delete(key);
}

/** Сбросить все состояния (тесты). */
export function resetLanguageDetectScheduler(): void {
  for (const state of states.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  states.clear();
}
