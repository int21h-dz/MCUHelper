/** Handshake сайдбара со сменой активного документа. Не использовать на обычный scheduleRefresh. */

export const SIDEBAR_ACK_TIMEOUT_MS = 2000;

export type SidebarRefreshTrigger = "editor-switch" | "schedule-refresh" | "lsp-ready";

/** getIndex после switch — только когда сервер подтвердил новый URI. Остальной refresh идёт напрямую. */
export function shouldHandshakeBeforeSidebarRefresh(trigger: SidebarRefreshTrigger): boolean {
  return trigger === "editor-switch";
}

/** Серверу нужен activeDocument при switch и при старте LSP; обычный refresh его не шлёт. */
export function shouldNotifyActiveDocument(trigger: SidebarRefreshTrigger): boolean {
  return trigger === "editor-switch" || trigger === "lsp-ready";
}

export function shouldAcceptActiveDocumentAck(opts: {
  ackUri: string | undefined;
  liveUri: string | undefined;
  pendingUri: string | undefined;
}): boolean {
  return Boolean(
    opts.ackUri &&
      opts.liveUri &&
      opts.pendingUri &&
      opts.ackUri === opts.liveUri &&
      opts.ackUri === opts.pendingUri
  );
}

/** Ack потерялся, URI всё ещё тот — один запасной getIndex, иначе «Загрузка индекса…» навсегда. */
export function shouldFallbackRefreshAfterAckTimeout(opts: {
  pendingUri: string | undefined;
  liveUri: string | undefined;
}): boolean {
  return Boolean(opts.pendingUri && opts.liveUri && opts.pendingUri === opts.liveUri);
}
