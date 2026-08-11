/** CloudTips «Поблагодарить» — URL только на стороне extension host. */
export const THANKS_URL = "https://pay.cloudtips.ru/p/84f5f8d5";

export function isAllowedThanksUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "pay.cloudtips.ru" &&
      u.pathname === "/p/84f5f8d5" &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

/** Открывать Диагностику после MCU-run только если есть что показать. */
export function shouldFocusDiagnosticsAfterRun(opts: {
  diagnosticCount: number;
  hasFirstError: boolean;
}): boolean {
  return opts.diagnosticCount > 0 || opts.hasFirstError;
}

export type McuRunMode = "i" | "c" | "f" | "b" | "continue";

/** Что открыть в редакторе после завершения MCU-шага. */
export type PostRunOpenTarget =
  | { kind: "fin"; path: string; overwritten?: boolean }
  | { kind: "lst"; path: string; reason: "debug" | "fin-missing" };

/** Кандидаты пути к NAME.LST (ответ LSP + runDir). */
export function lstPathCandidates(opts: {
  lstPath?: string;
  runDir?: string;
  variantName: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string | undefined) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  push(opts.lstPath);
  if (opts.runDir && opts.variantName) {
    const sep = opts.runDir.includes("\\") ? "\\" : "/";
    const base = opts.runDir.endsWith("\\") || opts.runDir.endsWith("/") ? opts.runDir.slice(0, -1) : opts.runDir;
    push(`${base}${sep}${opts.variantName}.LST`);
    push(`${base}${sep}${opts.variantName}.lst`);
  }
  return out;
}

/**
 * Debug / BURNUP → LST из temp-run.
 * Run/Final → FIN рядом с вариантом; если FIN нет — LST из temp-run.
 */
export function resolvePostRunOpenTarget(opts: {
  mode: McuRunMode;
  finCopiedPath?: string;
  finOverwritten?: boolean;
  lstPath?: string;
}): PostRunOpenTarget | undefined {
  if (opts.mode === "i" || opts.mode === "b") {
    return opts.lstPath ? { kind: "lst", path: opts.lstPath, reason: "debug" } : undefined;
  }
  if (opts.mode === "c" || opts.mode === "f") {
    if (opts.finCopiedPath) {
      return { kind: "fin", path: opts.finCopiedPath, overwritten: opts.finOverwritten };
    }
    if (opts.lstPath) {
      return { kind: "lst", path: opts.lstPath, reason: "fin-missing" };
    }
  }
  return undefined;
}
