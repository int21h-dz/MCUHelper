import * as path from "path";
import * as vscode from "vscode";

/** Запуск MCU-NR в Terminal: cwd = каталог mcu5.ini, PATH включает папку exe (DLL). */
export async function runMcuInTerminal(options: {
  mcuNrPath: string;
  runDir: string;
  title: string;
}): Promise<number | undefined> {
  const { mcuNrPath, runDir, title } = options;
  const exeDir = path.dirname(mcuNrPath);
  const commandLine = buildMcuLaunchCommand(mcuNrPath, runDir, exeDir);

  const env = {
    ...process.env,
    PATH: prependPath(exeDir),
    Path: prependPath(exeDir),
  };

  // На Windows терминал по умолчанию часто PowerShell 5.1 — там нет `&&` и `cd /d`.
  // Явно запускаем через cmd.exe /c (как в bat).
  const shellOptions: vscode.ShellExecutionOptions = { cwd: runDir, env };
  if (process.platform === "win32") {
    shellOptions.executable = "cmd.exe";
    shellOptions.shellArgs = ["/d", "/c"];
  }

  const task = new vscode.Task(
    { type: "mcuhelper", task: title },
    vscode.TaskScope.Workspace,
    title,
    "MCU-NR",
    new vscode.ShellExecution(commandLine, shellOptions)
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    focus: true,
    clear: false,
    showReuseMessage: false,
    echo: true,
  };
  task.problemMatchers = [];

  const execution = await vscode.tasks.executeTask(task);
  return waitForTaskProcessEnd(execution);
}

export function buildMcuLaunchCommand(mcuNrPath: string, runDir: string, exeDir: string): string {
  const qExe = shellQuote(mcuNrPath);
  const qDir = shellQuote(runDir);
  const qExeDir = shellQuote(exeDir);
  if (process.platform === "win32") {
    // Delayed expansion: сохранить код MCU после echo и вернуть его через exit /b
    // (иначе Task видит exit code последнего echo = 0).
    return (
      `setlocal EnableDelayedExpansion && cd /d ${qDir} && set "PATH=${exeDir};%PATH%" && ` +
      `${qExe} & set "EC=!ERRORLEVEL!" & echo. & echo [MCU-NR] finished, exit code: !EC! & exit /b !EC!`
    );
  }
  return (
    `cd ${qDir} && PATH=${qExeDir}:"$PATH" ${qExe}; EC=$?; echo ""; echo "[MCU-NR] finished, exit code: $EC"; exit $EC`
  );
}

function prependPath(exeDir: string): string {
  const cur = process.env.PATH ?? process.env.Path ?? "";
  return `${exeDir}${path.delimiter}${cur}`;
}

function shellQuote(p: string): string {
  if (process.platform === "win32") {
    return `"${p.replace(/"/g, '""')}"`;
  }
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function waitForTaskProcessEnd(execution: vscode.TaskExecution): Promise<number | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let processExit: number | undefined;
    let processEnded = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (code: number | undefined) => {
      if (settled) return;
      settled = true;
      subProcess.dispose();
      subTask.dispose();
      clearTimeout(fallbackTimer);
      clearTimeout(hardTimeout);
      resolve(code);
    };

    const subProcess = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution !== execution) return;
      processEnded = true;
      processExit = e.exitCode;
      finish(e.exitCode);
    });

    // EndTaskProcess иногда запаздывает: ждём до 5 с, не резолвим сразу с undefined.
    const subTask = vscode.tasks.onDidEndTask((e) => {
      if (e.execution !== execution) return;
      fallbackTimer = setTimeout(() => {
        if (processEnded) return;
        finish(processExit);
      }, 5000);
    });

    const hardTimeout = setTimeout(() => {
      vscode.window.showWarningMessage(
        "MCU-NR: таймаут ожидания завершения задачи в терминале"
      );
      finish(undefined);
    }, 86_400_000);
  });
}
