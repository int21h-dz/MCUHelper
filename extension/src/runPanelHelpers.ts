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
