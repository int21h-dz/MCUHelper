import * as fs from "fs";
import * as path from "path";
import { lstPathCandidates } from "./runPanelHelpers";
import { countLspWarnings } from "./batchValidate";

export type McuStepMode = "i" | "c" | "f" | "b" | "continue";

export interface RunStepLspResponse {
  ok: boolean;
  message?: string;
  exitCode?: number | null;
  diagnosticCount?: number;
  runDir?: string;
  mcuNrPath?: string;
  sourceFsPath?: string;
  prepared?: boolean;
  finCopiedPath?: string;
  finOverwritten?: boolean;
  lstPath?: string;
  diagnostics?: Array<{ severity?: number; message?: string }>;
  firstError?: {
    message: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    code?: string | number;
  };
}

export interface McuStepFlowResult {
  /** Итог collect (или false при сбое prepare). */
  ok: boolean;
  message?: string;
  exitCode?: number | null;
  diagnosticCount: number;
  warningCount: number;
  runDir?: string;
  sourceFsPath?: string;
  lstPath?: string;
  finCopiedPath?: string;
  finOverwritten?: boolean;
  firstError?: RunStepLspResponse["firstError"];
  prepared?: RunStepLspResponse;
  collect?: RunStepLspResponse;
}

/** Ищет NAME.LST на диске: ответ LSP, затем runDir (без учёта регистра). */
export function resolveExistingLstOnDisk(opts: {
  lstPath?: string;
  runDir?: string;
  variantName: string;
}): string | undefined {
  for (const p of lstPathCandidates(opts)) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  const runDir = opts.runDir;
  if (!runDir || !opts.variantName) return undefined;
  try {
    const want = `${opts.variantName}.lst`.toLowerCase();
    for (const entry of fs.readdirSync(runDir)) {
      if (entry.toLowerCase() === want) return path.join(runDir, entry);
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Общий поток prepareOnly → terminal → collectOnly (как Debug/Run в extension).
 * Без UI: навигация, open LST/FIN, сообщения — снаружи.
 */
export async function runMcuStepFlow(opts: {
  sendRequest: <T>(method: string, params: unknown) => Promise<T>;
  uri: string;
  variantName: string;
  mode: McuStepMode;
  mcuNrPath: string;
  constantsLibPath: string;
  stepTitle: string;
  runInTerminal: (o: {
    mcuNrPath: string;
    runDir: string;
    title: string;
  }) => Promise<number | undefined>;
}): Promise<McuStepFlowResult> {
  const { sendRequest, uri, variantName, mode, mcuNrPath, constantsLibPath, stepTitle, runInTerminal } =
    opts;

  const prepared = await sendRequest<RunStepLspResponse>("mcuhelper/runMcuStep", {
    uri,
    variantName,
    mode,
    mcuNrPath,
    constantsLibPath,
    prepareOnly: true,
  });

  if (prepared.message || !prepared.ok || !prepared.runDir || !prepared.mcuNrPath) {
    return {
      ok: false,
      message: prepared.message ?? "Не удалось подготовить запуск MCU-NR",
      diagnosticCount: 0,
      warningCount: 0,
      prepared,
    };
  }

  const exitCode = await runInTerminal({
    mcuNrPath: prepared.mcuNrPath,
    runDir: prepared.runDir,
    title: `${stepTitle} (${variantName})`,
  });

  const collect = await sendRequest<RunStepLspResponse>("mcuhelper/runMcuStep", {
    uri,
    variantName,
    mode,
    collectOnly: true,
    runDir: prepared.runDir,
    sourceFsPath: prepared.sourceFsPath,
    exitCode: exitCode ?? null,
  });

  if (collect.message) {
    return {
      ok: false,
      message: collect.message,
      exitCode,
      diagnosticCount: collect.diagnosticCount ?? 0,
      warningCount: countLspWarnings(collect.diagnostics),
      runDir: prepared.runDir,
      sourceFsPath: prepared.sourceFsPath,
      prepared,
      collect,
    };
  }

  const lstPath = resolveExistingLstOnDisk({
    lstPath: collect.lstPath,
    runDir: collect.runDir ?? prepared.runDir,
    variantName,
  });

  return {
    ok: collect.ok === true,
    exitCode,
    diagnosticCount: collect.diagnosticCount ?? 0,
    warningCount: countLspWarnings(collect.diagnostics),
    runDir: collect.runDir ?? prepared.runDir,
    sourceFsPath: collect.sourceFsPath ?? prepared.sourceFsPath,
    lstPath,
    finCopiedPath: collect.finCopiedPath,
    finOverwritten: collect.finOverwritten,
    firstError: collect.firstError,
    prepared,
    collect,
  };
}
