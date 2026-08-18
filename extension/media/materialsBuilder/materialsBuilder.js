/* Webview: справочник PNNL + черновик MATR. IIFE — голая «(» в скрипте ломает панель. */
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    metaLabel: document.getElementById("metaLabel"),
    search: document.getElementById("search"),
    list: document.getElementById("list"),
    listCount: document.getElementById("listCount"),
    btnBlank: document.getElementById("btnBlank"),
    inpNum: document.getElementById("inpNum"),
    inpT: document.getElementById("inpT"),
    inpRho: document.getElementById("inpRho"),
    inpComment: document.getElementById("inpComment"),
    selMode: document.getElementById("selMode"),
    rows: document.getElementById("rows"),
    addName: document.getElementById("addName"),
    addVal: document.getElementById("addVal"),
    btnAdd: document.getElementById("btnAdd"),
    impPct: document.getElementById("impPct"),
    btnImp: document.getElementById("btnImp"),
    desc: document.getElementById("desc"),
    preview: document.getElementById("preview"),
    warn: document.getElementById("warn"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnFromContext: document.getElementById("btnFromContext"),
    btnSaveUser: document.getElementById("btnSaveUser"),
    btnOpenUser: document.getElementById("btnOpenUser"),
    btnInsert: document.getElementById("btnInsert"),
    targetLabel: document.getElementById("targetLabel"),
    awlibList: document.getElementById("awlibList"),
  };

  let catalog = [];
  let selectedName = null;
  let applying = false;

  function haystack(m) {
    const parts = [
      m.name,
      m.displayName,
      m.formula || "",
      m.acronym || "",
      m.source || "",
      (m.comment || []).join(" "),
      (m.references || []).join(" "),
    ];
    for (const eln of m.elements || []) {
      parts.push(eln.element);
      for (const iso of eln.isotopes || []) parts.push(iso);
    }
    if (m.user) parts.push("своё", "свое", "user");
    return parts.join("\n").toLowerCase();
  }

  function matches(m, q) {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = haystack(m);
    return tokens.every(function (tok) {
      return hay.indexOf(tok) >= 0;
    });
  }

  function renderList() {
    const q = el.search.value || "";
    const hits = catalog.filter(function (m) {
      return matches(m, q);
    });
    el.listCount.textContent = hits.length + " / " + catalog.length;
    const html = hits
      .slice(0, 500)
      .map(function (m) {
        const key = m.user ? "user:" + m.name : m.name;
        const sel = key === selectedName ? " sel" : "";
        const ru = m.displayName || m.name;
        const en = !m.user && ru !== m.name ? '<span class="mb-item-en">' + escapeHtml(m.name) + "</span>" : "";
        const mine = m.user ? '<span class="mb-mine">своё</span>' : "";
        return (
          '<button type="button" class="mb-item' +
          sel +
          '" data-name="' +
          escapeHtml(m.name) +
          '" data-user="' +
          (m.user ? "1" : "0") +
          '"><span class="mb-item-ru">' +
          escapeHtml(ru) +
          mine +
          "</span>" +
          en +
          "</button>"
        );
      })
      .join("");
    el.list.innerHTML = html || '<p class="mb-item-en">Ничего не найдено</p>';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDraft(msg) {
    const d = msg.draft;
    if (!d) return;
    applying = true;
    el.inpNum.value = d.number != null ? String(d.number) : "";
    el.inpT.value = d.temperature != null ? String(d.temperature) : "";
    el.inpRho.value = d.densityGcm3 != null ? String(d.densityGcm3) : "";
    if (el.inpComment && document.activeElement !== el.inpComment) {
      el.inpComment.value = d.comment || "";
    }
    el.selMode.value = d.mode || "denswa";
    const isotope = (d.mode || "denswa") === "isotope";
    el.inpRho.readOnly = isotope;
    el.inpRho.title = isotope
      ? "ρ считается по ядерным dens и AW.LIB"
      : "Плотность DENSWA — задайте вручную";
    if (el.targetLabel) {
      const lab = msg.targetLabel || "";
      el.targetLabel.textContent = lab;
      el.targetLabel.hidden = !lab;
    }
    selectedName = msg.selectedName;
    const rows = d.nuclides || [];
    el.rows.innerHTML = rows
      .map(function (n, i) {
        const badge = n.impurity ? '<span class="mb-imp">примесь</span>' : "";
        const miss = n.inAwLib === false ? '<span class="mb-miss">нет в AW.LIB</span>' : "";
        return (
          "<tr><td><input data-i=\"" +
          i +
          '" data-f="name" value="' +
          escapeHtml(n.name) +
          '" />' +
          badge +
          miss +
          '</td><td><input data-i="' +
          i +
          '" data-f="value" type="number" step="any" value="' +
          escapeHtml(String(n.value)) +
          '" /></td><td><button type="button" class="mb-btn mb-btn-x" data-del="' +
          i +
          '">×</button></td></tr>'
        );
      })
      .join("");
    const sel = msg.selected;
    if (sel) {
      const bits = [];
      bits.push("<strong>" + escapeHtml(sel.displayName || sel.name) + "</strong>");
      if (sel.user) bits.push("пользовательский банк");
      if (sel.formula) bits.push("формула " + escapeHtml(sel.formula));
      if (sel.source && sel.source !== "user") bits.push(escapeHtml(sel.source));
      const comments = (sel.comment || []).join(" ");
      if (comments) bits.push(escapeHtml(comments));
      const refs = (sel.references || []).join(" ");
      if (refs) bits.push(escapeHtml(refs));
      el.desc.hidden = false;
      el.desc.innerHTML = bits.join("<br/>");
    } else if (!rows.length) {
      el.desc.hidden = false;
      el.desc.textContent = "Пустой состав — наберите нуклиды из AW.LIB или выберите материал слева.";
    } else {
      el.desc.hidden = true;
      el.desc.textContent = "";
    }
    el.preview.textContent = msg.preview || "";
    const warns = msg.warnings || d.warnings || [];
    if (warns.length) {
      el.warn.hidden = false;
      el.warn.textContent = warns.join(" · ");
    } else {
      el.warn.hidden = true;
      el.warn.textContent = "";
    }
    applying = false;
    renderList();
  }

  el.list.addEventListener("click", function (ev) {
    const btn = ev.target.closest("button[data-name]");
    if (!btn) return;
    vscode.postMessage({
      type: "pick",
      name: btn.getAttribute("data-name"),
      user: btn.getAttribute("data-user") === "1",
    });
  });

  el.search.addEventListener("input", function () {
    renderList();
  });

  el.btnBlank.addEventListener("click", function () {
    vscode.postMessage({ type: "blank" });
  });

  el.inpRho.addEventListener("change", function () {
    if (applying) return;
    vscode.postMessage({ type: "setRho", rho: Number(el.inpRho.value) });
  });
  el.inpT.addEventListener("change", function () {
    if (applying) return;
    const v = el.inpT.value.trim();
    vscode.postMessage({ type: "setT", T: v ? Number(v) : null });
  });
  if (el.inpComment) {
    el.inpComment.addEventListener("input", function () {
      if (applying) return;
      vscode.postMessage({ type: "setComment", comment: el.inpComment.value });
    });
  }
  el.selMode.addEventListener("change", function () {
    if (applying) return;
    vscode.postMessage({ type: "setMode", mode: el.selMode.value });
  });

  el.rows.addEventListener("change", function (ev) {
    const inp = ev.target;
    if (!inp || !inp.getAttribute) return;
    const i = Number(inp.getAttribute("data-i"));
    const f = inp.getAttribute("data-f");
    if (f === "name") vscode.postMessage({ type: "setNuclide", index: i, name: inp.value });
    if (f === "value") vscode.postMessage({ type: "setNuclide", index: i, value: Number(inp.value) });
  });
  el.rows.addEventListener("click", function (ev) {
    const btn = ev.target.closest("button[data-del]");
    if (!btn) return;
    vscode.postMessage({ type: "removeNuclide", index: Number(btn.getAttribute("data-del")) });
  });

  el.btnAdd.addEventListener("click", function () {
    vscode.postMessage({
      type: "addNuclide",
      name: el.addName.value,
      value: Number(el.addVal.value) || 0,
    });
  });
  el.btnImp.addEventListener("click", function () {
    vscode.postMessage({
      type: "addImpurity",
      name: el.addName.value,
      weightPercent: Number(el.impPct.value) || 0,
    });
  });
  el.btnRefresh.addEventListener("click", function () {
    vscode.postMessage({ type: "refreshContext" });
  });
  el.btnFromContext.addEventListener("click", function () {
    vscode.postMessage({ type: "fromContext" });
  });
  el.btnSaveUser.addEventListener("click", function () {
    vscode.postMessage({ type: "saveUser" });
  });
  if (el.btnOpenUser) {
    el.btnOpenUser.addEventListener("click", function () {
      vscode.postMessage({ type: "openUserCatalog" });
    });
  }
  el.btnInsert.addEventListener("click", function () {
    vscode.postMessage({ type: "insertNew" });
  });

  document.addEventListener("click", function (ev) {
    const a = ev.target && ev.target.closest ? ev.target.closest("a[data-url]") : null;
    if (!a) return;
    ev.preventDefault();
    vscode.postMessage({ type: "openUrl", url: a.getAttribute("data-url") });
  });

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "init") {
      catalog = msg.catalog || [];
      const meta = msg.meta || {};
      const userN = meta.userCount || 0;
      el.metaLabel.textContent =
        meta.materialCount +
        " материалов" +
        (userN ? " · " + userN + " своих" : "") +
        " · " +
        (meta.source === "cache" ? "кэш" : "бандл") +
        " · AW.LIB " +
        (meta.awLibCount || 0);
      if (msg.userCatalogPath && el.btnSaveUser) {
        el.btnSaveUser.title = msg.userCatalogPath;
        if (el.btnOpenUser) el.btnOpenUser.title = msg.userCatalogPath;
        el.metaLabel.title = msg.userCatalogPath;
      }
      const names = msg.awlib || [];
      el.awlibList.innerHTML = names
        .map(function (n) {
          return '<option value="' + escapeHtml(n) + '"></option>';
        })
        .join("");
      renderDraft(msg);
    }
    if (msg.type === "catalog") {
      catalog = msg.catalog || catalog;
      if (msg.userCatalogPath && el.btnSaveUser) {
        el.btnSaveUser.title = msg.userCatalogPath;
        if (el.btnOpenUser) el.btnOpenUser.title = msg.userCatalogPath;
        el.metaLabel.title = msg.userCatalogPath;
      }
      renderList();
    }
    if (msg.type === "draft") renderDraft(msg);
  });

  vscode.postMessage({ type: "ready" });
})();
