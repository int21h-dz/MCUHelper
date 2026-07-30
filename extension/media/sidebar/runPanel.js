/* global acquireVsCodeApi, McuSidebarIcons */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const I = window.McuSidebarIcons;

  /** Defaults from package.json; пользователь может переназначить в Keyboard Shortcuts. */
  const RUN_SHORTCUTS = {
    "mcuhelper.debugInput": "Ctrl+Alt+D",
    "mcuhelper.runCalculation": "Ctrl+Alt+R",
    "mcuhelper.continueCalculation": "Ctrl+Alt+Shift+C",
    "mcuhelper.finalOutput": "Ctrl+Alt+F",
  };

  let status = {
    hasDoc: false,
    mcuNrPath: "",
    constantsLibPath: "",
    pathsReady: false,
  };

  function esc(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function runDisabledReason() {
    if (!status.hasDoc) return "Откройте файл MCU-NR";
    if (!status.pathsReady) {
      return "Сначала укажите пути (шестерёнка в заголовке панели или Ctrl+Alt+P)";
    }
    return "";
  }

  function pathsTooltip() {
    const lines = [
      "Пути MCU-NR (шестерёнка в заголовке · Ctrl+Alt+P)",
      "",
      "exe: " + (status.mcuNrPath || "не задан"),
      "MDBNR: " + (status.constantsLibPath || "не задан"),
    ];
    return lines.join("\n");
  }

  function panelTitle() {
    const base = (I.PANELS["mcuhelper.run"] && I.PANELS["mcuhelper.run"].hint) || "";
    return base + "\n\n" + pathsTooltip();
  }

  function render() {
    const accent = "#e8913a";
    const canRun = status.hasDoc && status.pathsReady;
    const disabledReason = runDisabledReason();

    root.innerHTML =
      '<div class="mcu-panel-shell mcu-run-panel" style="--panel-accent:' +
      accent +
      '" title="' +
      esc(panelTitle()) +
      '">' +
      '<div class="mcu-run-actions mcu-run-actions-row">' +
      btn("debug", "Debug — INPUT · проверка данных", "mcuhelper.debugInput", canRun, disabledReason, "debug") +
      btn("play", "Run — CALCULATION · расчёт", "mcuhelper.runCalculation", canRun, disabledReason, "run") +
      btn(
        "sync",
        "Continue — продолжить расчёт",
        "mcuhelper.continueCalculation",
        canRun,
        disabledReason,
        "continue"
      ) +
      btn("output", "Final — OUTPUT · финальная выдача", "mcuhelper.finalOutput", canRun, disabledReason, "final") +
      '<button type="button" class="mcu-run-btn mcu-run-btn-icon-only mcu-run-thanks" data-thanks="1" title="' +
      esc("Поблагодарить — CloudTips") +
      '">' +
      I.getIcon("heart") +
      "</button>" +
      "</div></div>";

    root.querySelectorAll("[data-cmd]").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.classList.contains("is-disabled")) return;
        vscode.postMessage({ type: "run", command: el.getAttribute("data-cmd") });
      });
    });

    root.querySelectorAll("[data-thanks]").forEach((el) => {
      el.addEventListener("click", () => {
        vscode.postMessage({ type: "thanks" });
      });
    });
  }

  function btn(icon, tooltip, command, enabled, disabledReason, kind) {
    const shortcut = RUN_SHORTCUTS[command];
    const fullTip = shortcut ? tooltip + " (" + shortcut + ")" : tooltip;
    const title = enabled ? fullTip : disabledReason || fullTip;
    return (
      '<button type="button" class="mcu-run-btn mcu-run-btn-icon-only mcu-run-btn-' +
      kind +
      (enabled ? "" : " is-disabled") +
      '" data-cmd="' +
      esc(command) +
      '" title="' +
      esc(title) +
      '"' +
      (enabled ? "" : " disabled") +
      ">" +
      '<span class="mcu-run-btn-icon">' +
      I.getIcon(icon) +
      "</span></button>"
    );
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "status") return;
    status = {
      hasDoc: !!msg.hasDoc,
      mcuNrPath: msg.mcuNrPath || "",
      constantsLibPath: msg.constantsLibPath || "",
      pathsReady: !!msg.pathsReady,
    };
    render();
  });

  vscode.postMessage({ type: "ready" });
})();
