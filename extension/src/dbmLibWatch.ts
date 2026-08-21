/**
 * Мониторинг *.DBM в корне MDBNR: создание/правка в том же сеансе без Reload Window.
 */

import * as path from "path";
import * as vscode from "vscode";

export function isDbmBasename(name: string): boolean {
  return /\.dbm$/i.test(name);
}

/** Файл лежит прямо в корне MDBNR (не во вложенных папках). */
export function isDbmInLibRoot(fsPath: string, libRoot: string): boolean {
  const root = libRoot?.trim();
  if (!root || !fsPath) return false;
  const dir = path.dirname(fsPath);
  const sameDir =
    path.resolve(dir).localeCompare(path.resolve(root), undefined, { sensitivity: "accent" }) === 0;
  return sameDir && isDbmBasename(path.basename(fsPath));
}

export type DbmReloadFn = () => void | Promise<void>;

/**
 * Подписка на появление/изменение/удаление *.DBM в корне MDBNR.
 * Возвращает Disposable; при смене пути вызовите заново.
 */
export function watchDbmLibraryRoot(
  libRoot: string,
  onChange: DbmReloadFn,
  opts?: { debounceMs?: number }
): vscode.Disposable {
  const root = libRoot?.trim();
  if (!root) {
    return { dispose() {} };
  }

  const debounceMs = opts?.debounceMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void Promise.resolve(onChange()).catch(() => {
        /* ignore */
      });
    }, debounceMs);
  };

  const disposables: vscode.Disposable[] = [];

  try {
    const base = vscode.Uri.file(root);
    // Два glob: на case-sensitive FS `*.DBM` не ловит `.dbm`.
    for (const glob of ["*.DBM", "*.dbm"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, glob)
      );
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      disposables.push(watcher);
    }
  } catch {
    /* путь недоступен — остаётся fallback по save/createFiles */
  }

  disposables.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === "file" && isDbmInLibRoot(doc.uri.fsPath, root)) schedule();
    })
  );
  disposables.push(
    vscode.workspace.onDidCreateFiles((e) => {
      if (e.files.some((u) => u.scheme === "file" && isDbmInLibRoot(u.fsPath, root))) schedule();
    })
  );
  disposables.push(
    vscode.workspace.onDidDeleteFiles((e) => {
      if (e.files.some((u) => u.scheme === "file" && isDbmInLibRoot(u.fsPath, root))) schedule();
    })
  );
  disposables.push(
    vscode.workspace.onDidRenameFiles((e) => {
      if (
        e.files.some(
          (f) =>
            (f.oldUri.scheme === "file" && isDbmInLibRoot(f.oldUri.fsPath, root)) ||
            (f.newUri.scheme === "file" && isDbmInLibRoot(f.newUri.fsPath, root))
        )
      ) {
        schedule();
      }
    })
  );

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      for (const d of disposables) d.dispose();
    },
  };
}
