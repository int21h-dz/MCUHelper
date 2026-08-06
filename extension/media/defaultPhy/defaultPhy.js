/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  const COLS = [
    { key: "name", label: "NAME", kind: "text", cls: "col-name" },
    { key: "ace", label: "ACE", kind: "select", opt: "ace" },
    { key: "mods", label: "MODS", kind: "select", opt: "mods" },
    { key: "block", label: "BLOCK", kind: "text", cls: "col-num" },
    { key: "ehr", label: "EHR", kind: "text", cls: "col-num" },
    { key: "dtem", label: "DTEM", kind: "text", cls: "col-num" },
    { key: "phs", label: "PHS", kind: "text" },
    { key: "pht", label: "PHT", kind: "select", opt: "pht" },
    { key: "prd", label: "PRD", kind: "text", cls: "col-num" },
    { key: "eur", label: "EUR", kind: "text", cls: "col-num" },
    { key: "fcb", label: "FCB", kind: "text", cls: "col-num" },
    { key: "wcb", label: "WCB", kind: "text", cls: "col-num" },
  ];

  let state = {
    filePath: "",
    encoding: "utf8",
    dirty: false,
    underLibRoot: false,
    fatal: false,
    warnings: [],
    rows: [],
    options: { ace: [], mods: [], pht: [] },
  };
  let filter = "";
  let selected = new Set();
  let debounceTimer = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function schedulePush() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      vscode.postMessage({ type: "change", rows: state.rows });
    }, 200);
  }

  function visibleIndices() {
    const q = filter.trim().toUpperCase();
    const out = [];
    for (let i = 0; i < state.rows.length; i++) {
      if (!q || String(state.rows[i].name || "").toUpperCase().includes(q)) out.push(i);
    }
    return out;
  }

  function selectOptions(list, current) {
    const set = new Set(list || []);
    if (current) set.add(current);
    const opts = [...set].sort((a, b) => String(a).localeCompare(String(b)));
    let html = "";
    for (const v of opts) {
      html +=
        '<option value="' +
        esc(v) +
        '"' +
        (v === current ? " selected" : "") +
        ">" +
        esc(v) +
        "</option>";
    }
    if (current && !list.includes(current)) {
      /* already added */
    }
    html += '<option value="__custom__">… своё</option>';
    return html;
  }

  function cellHtml(col, row, rowIndex) {
    const val = row[col.key] == null ? "" : String(row[col.key]);
    if (col.kind === "select") {
      const list = state.options[col.opt] || [];
      return (
        '<select data-row="' +
        rowIndex +
        '" data-key="' +
        col.key +
        '">' +
        selectOptions(list, val) +
        "</select>"
      );
    }
    return (
      '<input type="text" class="' +
      esc(col.cls || "") +
      '" data-row="' +
      rowIndex +
      '" data-key="' +
      col.key +
      '" value="' +
      esc(val) +
      '">'
    );
  }

  function render() {
    const warnCount = (state.warnings || []).length;
    const vis = visibleIndices();
    let rowsHtml = "";
    if (!vis.length) {
      rowsHtml =
        '<tr><td colspan="' +
        (COLS.length + 2) +
        '" class="phy-empty">' +
        (state.rows.length ? "Нет строк по фильтру" : "Нет данных — нажмите «Добавить»") +
        "</td></tr>";
    } else {
      for (const i of vis) {
        const row = state.rows[i];
        const sel = selected.has(i) ? " is-selected" : "";
        rowsHtml += '<tr class="' + sel + '" data-index="' + i + '">';
        rowsHtml +=
          '<td class="col-check"><input type="checkbox" data-sel="' +
          i +
          '"' +
          (selected.has(i) ? " checked" : "") +
          "></td>";
        rowsHtml += '<td class="col-idx">' + esc(String(i + 1)) + "</td>";
        for (const col of COLS) {
          rowsHtml += "<td>" + cellHtml(col, row, i) + "</td>";
        }
        rowsHtml += "</tr>";
      }
    }

    root.innerHTML =
      '<div class="phy-banner"><strong>Внимание:</strong> штатно MCU не рекомендует править DEFAULT.PHY — используйте карту <code>DEF</code> в исходных данных. Правка банка MDBNR влияет на все расчёты.</div>' +
      '<div class="phy-toolbar">' +
      '<span class="path' +
      (state.dirty ? " is-dirty" : "") +
      '" title="' +
      esc(state.filePath) +
      '">' +
      esc(state.filePath || "—") +
      "</span>" +
      '<input class="phy-filter" type="search" placeholder="Фильтр NAME…" value="' +
      esc(filter) +
      '">' +
      '<button type="button" class="phy-btn secondary" data-act="add">Добавить</button>' +
      '<button type="button" class="phy-btn danger" data-act="del"' +
      (selected.size ? "" : " disabled") +
      ">Удалить</button>" +
      '<button type="button" class="phy-btn secondary" data-act="def"' +
      (selected.size ? "" : " disabled") +
      ">Вставить DEF</button>" +
      '<button type="button" class="phy-btn" data-act="save">Сохранить</button>' +
      '<button type="button" class="phy-btn secondary" data-act="saveAs">Сохранить как</button>' +
      "</div>" +
      '<div class="phy-meta">кодировка: ' +
      esc(state.encoding) +
      (state.underLibRoot ? " · MDBNR" : " · копия") +
      (warnCount ? " · предупреждений: " + warnCount : "") +
      (state.fatal ? " · FATAL" : "") +
      " · строк: " +
      state.rows.length +
      (filter ? " (показано " + vis.length + ")" : "") +
      "</div>" +
      '<div class="phy-table-wrap"><table class="phy-table"><thead><tr>' +
      '<th class="col-check"></th><th class="col-idx">№</th>' +
      COLS.map(function (c) {
        return "<th>" + esc(c.label) + "</th>";
      }).join("") +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>";

    bind();
  }

  function bind() {
    const filterEl = root.querySelector(".phy-filter");
    if (filterEl) {
      filterEl.addEventListener("input", function () {
        filter = filterEl.value;
        render();
      });
    }

    root.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const act = btn.getAttribute("data-act");
        if (act === "add") vscode.postMessage({ type: "addRow" });
        if (act === "del") {
          vscode.postMessage({ type: "deleteRows", indices: [...selected] });
          selected = new Set();
        }
        if (act === "save") vscode.postMessage({ type: "save" });
        if (act === "saveAs") vscode.postMessage({ type: "saveAs" });
        if (act === "def") vscode.postMessage({ type: "insertDef", indices: [...selected] });
      });
    });

    root.querySelectorAll("[data-sel]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        const i = Number(cb.getAttribute("data-sel"));
        if (cb.checked) selected.add(i);
        else selected.delete(i);
        render();
      });
    });

    root.querySelectorAll("input[data-key], select[data-key]").forEach(function (el) {
      const handler = function () {
        const i = Number(el.getAttribute("data-row"));
        const key = el.getAttribute("data-key");
        let val = el.value;
        if (el.tagName === "SELECT" && val === "__custom__") {
          const custom = window.prompt("Значение " + key.toUpperCase() + ":", state.rows[i][key] || "");
          if (custom == null) {
            render();
            return;
          }
          val = custom.trim();
          const optKey = key === "ace" ? "ace" : key === "pht" ? "pht" : key === "mods" ? "mods" : null;
          if (optKey && val && state.options[optKey] && !state.options[optKey].includes(val)) {
            state.options[optKey] = state.options[optKey].concat([val]).sort(function (a, b) {
              return String(a).localeCompare(String(b));
            });
          }
        }
        if (!state.rows[i]) return;
        state.rows[i][key] = val;
        state.dirty = true;
        schedulePush();
      };
      el.addEventListener(el.tagName === "SELECT" ? "change" : "change", handler);
      if (el.tagName === "INPUT") el.addEventListener("input", handler);
    });
  }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || msg.type !== "state") return;
    state = {
      filePath: msg.filePath || "",
      encoding: msg.encoding || "utf8",
      dirty: !!msg.dirty,
      underLibRoot: !!msg.underLibRoot,
      fatal: !!msg.fatal,
      warnings: msg.warnings || [],
      rows: (msg.rows || []).map(function (r) {
        return Object.assign({}, r);
      }),
      options: msg.options || { ace: [], mods: [], pht: [] },
    };
    const max = state.rows.length;
    selected = new Set([...selected].filter(function (i) {
      return i >= 0 && i < max;
    }));
    render();
  });

  vscode.postMessage({ type: "ready" });
})();
