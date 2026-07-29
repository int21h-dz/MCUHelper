/* global acquireVsCodeApi, McuSidebarIcons */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const I = window.McuSidebarIcons;

  let status = {
    hasDoc: false,
    variantName: "",
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

  function shortPath(p) {
    if (!p) return "не задан";
    const parts = String(p).split(/[/\\]/);
    if (parts.length <= 2) return p;
    return "…/" + parts.slice(-2).join("/");
  }

  function render() {
    const accent = "#e8913a";
    const canRun = status.hasDoc && status.pathsReady;
    const hint = !status.hasDoc
      ? "Откройте файл MCU-NR"
      : !status.pathsReady
        ? "Сначала укажите пути к exe и MDBNR"
        : "Вариант: " + status.variantName;

    root.innerHTML =
      '<div class="mcu-panel-shell mcu-run-panel" style="--panel-accent:' +
      accent +
      '">' +
      '<header class="mcu-panel-head">' +
      '<span class="mcu-icon-wrap">' +
      I.getIcon("run") +
      "</span>" +
      '<span class="mcu-panel-title">Запуск MCU-NR</span></header>' +
      '<div class="mcu-panel-hint">' +
      esc(hint) +
      "</div>" +
      '<div class="mcu-run-paths">' +
      '<div class="mcu-run-path"><span class="mcu-run-path-k">exe</span><span class="mcu-run-path-v" title="' +
      esc(status.mcuNrPath) +
      '">' +
      esc(shortPath(status.mcuNrPath)) +
      "</span></div>" +
      '<div class="mcu-run-path"><span class="mcu-run-path-k">MDBNR</span><span class="mcu-run-path-v" title="' +
      esc(status.constantsLibPath) +
      '">' +
      esc(shortPath(status.constantsLibPath)) +
      "</span></div>" +
      "</div>" +
      '<div class="mcu-run-actions">' +
      btn("debug", "Debug", "INPUT · проверка данных", "mcuhelper.debugInput", canRun, "debug") +
      btn("play", "Run", "CALCULATION · расчёт", "mcuhelper.runCalculation", canRun, "run") +
      btn("sync", "Continue", "продолжить расчёт", "mcuhelper.continueCalculation", canRun, "continue") +
      btn("output", "Final", "OUTPUT · финальная выдача", "mcuhelper.finalOutput", canRun, "final") +
      btn("gear", "Настроить пути", "exe MCU-NR и папка MDBNR", "mcuhelper.configureSolver", true, "setup") +
      "</div></div>";

    root.querySelectorAll("[data-cmd]").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.classList.contains("is-disabled")) return;
        vscode.postMessage({ type: "run", command: el.getAttribute("data-cmd") });
      });
    });
  }

  function btn(icon, title, sub, command, enabled, kind) {
    return (
      '<button type="button" class="mcu-run-btn mcu-run-btn-' +
      kind +
      (enabled ? "" : " is-disabled") +
      '" data-cmd="' +
      esc(command) +
      '"' +
      (enabled ? "" : " disabled") +
      ">" +
      '<span class="mcu-run-btn-icon">' +
      I.getIcon(icon) +
      "</span>" +
      '<span class="mcu-run-btn-text">' +
      '<span class="mcu-run-btn-title">' +
      esc(title) +
      "</span>" +
      '<span class="mcu-run-btn-sub">' +
      esc(sub) +
      "</span></span></button>"
    );
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "status") return;
    status = {
      hasDoc: !!msg.hasDoc,
      variantName: msg.variantName || "",
      mcuNrPath: msg.mcuNrPath || "",
      constantsLibPath: msg.constantsLibPath || "",
      pathsReady: !!msg.pathsReady,
    };
    render();
  });

  vscode.postMessage({ type: "ready" });
})();
