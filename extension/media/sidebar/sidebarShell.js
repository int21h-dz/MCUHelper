/* global acquireVsCodeApi, McuSidebarIcons */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const I = window.McuSidebarIcons;

  let state = { mode: "empty", catalog: null, tree: null, panel: "", filter: "" };
  /**
   * Раскрытые группы по панели.
   * Первый запуск: всё свёрнуто. Дальше восстанавливаем последнее состояние пользователя.
   */
  const expandedGroups = restoreExpandedGroups(vscode.getState());

  function restoreExpandedGroups(savedState) {
    const restored = {};
    const groups = savedState && savedState.expandedGroups;
    if (!groups || typeof groups !== "object") return restored;
    for (const [panelId, keys] of Object.entries(groups)) {
      if (Array.isArray(keys)) restored[panelId] = new Set(keys.filter((key) => typeof key === "string"));
    }
    return restored;
  }

  function persistUiState() {
    const serialized = {};
    for (const [panelId, keys] of Object.entries(expandedGroups)) {
      serialized[panelId] = Array.from(keys);
    }
    vscode.setState({ expandedGroups: serialized });
  }

  function esc(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function panelShellOpen(panelId) {
    const accent = I.panelAccent(panelId);
    return (
      '<div class="mcu-panel-shell" style="--panel-accent:' +
      esc(accent) +
      '">' +
      panelChrome(panelId)
    );
  }

  function panelChrome(panelId) {
    const meta = I.PANELS[panelId] || { title: "MCU-NR", icon: "catalog", hint: "" };
    return (
      '<header class="mcu-panel-head">' +
      '<span class="mcu-icon-wrap">' +
      I.getIcon(meta.icon) +
      "</span>" +
      '<span class="mcu-panel-title">' +
      esc(meta.title) +
      "</span></header>" +
      (meta.hint ? '<div class="mcu-panel-hint">' + esc(meta.hint) + "</div>" : "")
    );
  }

  function searchHtml(inputId, placeholder) {
    return (
      '<div class="mcu-search-wrap">' +
      I.getIcon("search") +
      '<input type="search" class="mcu-search" id="' +
      inputId +
      '" placeholder="' +
      esc(placeholder || "Поиск…") +
      '" autocomplete="off" />' +
      "</div>"
    );
  }

  function catalogSearchHtml() {
    return searchHtml("mcu-search", "Поиск карт…");
  }

  function navSearchHtml() {
    const meta = I.PANELS[state.panel] || {};
    return searchHtml("mcu-nav-search", meta.searchPh || "Поиск…");
  }

  function navPillLabel(node) {
    const id = node.id || "";
    if (id.startsWith("mat-") && !id.includes("-n-")) {
      const num = id.slice(4);
      return num ? "#" + num : node.label;
    }
    if (id.startsWith("mat-") && id.includes("-n-")) {
      return node.label;
    }
    if (node.label.length <= 10) return node.label;
    return node.label.slice(0, 9) + "…";
  }

  function nodeSearchText(node) {
    let head = "";
    const id = node.id || "";
    if (id.startsWith("mat-") && !id.includes("-n-")) {
      head = "#" + id.slice(4) + " ";
    }
    return (head + node.label + " " + (node.description || "") + " " + (node.badges || []).join(" ")).toLowerCase();
  }

  function cardCopyText(node) {
    const parts = [node.label, node.description].filter(Boolean);
    return parts.join(" — ");
  }

  function renderNavCard(node) {
    const clickable = node.uri && node.range;
    const pill = navPillLabel(node);
    const line = node.description || node.label;
    const copyText = cardCopyText(node);
    const detail =
      node.description && node.description.length > 40
        ? '<div class="mcu-card-detail"><div class="mcu-card-desc">' +
          esc(node.label) +
          " — " +
          esc(node.description) +
          "</div></div>"
        : node.description
          ? '<div class="mcu-card-detail"><div class="mcu-card-desc">' + esc(node.description) + "</div></div>"
          : "";
    return (
      '<div class="mcu-card mcu-nav-card' +
      (clickable ? " leaf-clickable" : "") +
      '" data-uri="' +
      esc(node.uri || "") +
      '" data-range="' +
      esc(node.range ? JSON.stringify(node.range) : "") +
      '" data-search="' +
      esc(nodeSearchText(node)) +
      '" data-copy="' +
      esc(copyText) +
      '">' +
      '<span class="mcu-card-label">' +
      esc(pill) +
      "</span>" +
      '<span class="mcu-card-title">' +
      esc(line) +
      "</span>" +
      detail +
      "</div>"
    );
  }

  function renderNavGroup(node) {
    const pill = navPillLabel(node);
    const count = node.children ? node.children.length : 0;
    const marker = node.description
      ? '<span class="mcu-marker">' + esc(node.description) + "</span>"
      : '<span class="mcu-marker">' + count + " эл.</span>";
    const openCls = isGroupExpanded(node.id) ? " open" : "";
    return (
      '<div class="mcu-accordion mcu-nav-group' +
      openCls +
      '" data-group-id="' +
      esc(node.id) +
      '" data-search="' +
      esc(nodeSearchText(node)) +
      '">' +
      '<div class="mcu-accordion-header branch">' +
      '<span class="mcu-chevron" data-action="toggle">' +
      I.getIcon("chevron") +
      "</span>" +
      '<span class="mcu-module-icon mcu-module-icon-mat">' +
      esc(pill) +
      "</span>" +
      '<span class="mcu-module-title">' +
      esc(node.label) +
      "</span>" +
      marker +
      "</div>" +
      '<div class="mcu-accordion-body"><div class="mcu-card-grid">' +
      renderTreeNodes(node.children) +
      "</div></div></div>"
    );
  }

  function renderTreeNodes(nodes) {
    if (!nodes || !nodes.length) return "";
    let html = "";
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        html += renderNavGroup(node);
      } else {
        html += renderNavCard(node);
      }
    }
    return html;
  }

  function renderEmpty(message) {
    root.innerHTML =
      panelShellOpen(state.panel) +
      '<div class="mcu-empty">' +
      I.getIcon("empty") +
      "<div>" +
      esc(message || "Откройте файл MCU-NR") +
      "</div></div></div>";
  }

  function bindDrag(el, text, format) {
    if (!text) return;
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", text);
      e.dataTransfer.setData("application/mcuhelper.snippet", format === "snippet" ? "1" : "0");
      e.dataTransfer.effectAllowed = "copy";
    });
  }

  function bindInsert(el, text, format) {
    bindDrag(el, text, format);
    el.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      vscode.postMessage({ type: "insert", text, format: format || "plain" });
    });
  }

  function groupKey(nodeId) {
    return (state.panel || "") + ":" + nodeId;
  }

  function stateIdForNode(nodeEl) {
    return nodeEl.getAttribute("data-state-id") || nodeEl.getAttribute("data-group-id") || "";
  }

  function isGroupExpanded(nodeId) {
    const set = expandedGroups[state.panel];
    return set ? set.has(groupKey(nodeId)) : false;
  }

  function setGroupExpanded(nodeId, open) {
    if (!state.panel) return;
    if (!expandedGroups[state.panel]) expandedGroups[state.panel] = new Set();
    const k = groupKey(nodeId);
    if (open) expandedGroups[state.panel].add(k);
    else expandedGroups[state.panel].delete(k);
    persistUiState();
  }

  function toggleNode(nodeEl) {
    const id = stateIdForNode(nodeEl);
    const willOpen = !nodeEl.classList.contains("open");
    nodeEl.classList.toggle("open");
    if (id) setGroupExpanded(id, willOpen);
  }

  function applyCatalogFilter(q) {
    const query = (q || "").trim().toLowerCase();
    let visible = 0;
    root.querySelectorAll(".mcu-card").forEach((card) => {
      const label = (card.getAttribute("data-label") || "").toLowerCase();
      const title = (card.querySelector(".mcu-card-title")?.textContent || "").toLowerCase();
      const show = !query || label.includes(query) || title.includes(query);
      card.classList.toggle("mcu-hidden", !show);
      if (show) visible++;
    });
    let nr = root.querySelector(".mcu-no-results");
    if (query && visible === 0) {
      if (!nr) {
        nr = document.createElement("div");
        nr.className = "mcu-no-results";
        nr.textContent = "Ничего не найдено";
        root.querySelector(".mcu-catalog-body")?.appendChild(nr);
      }
    } else if (nr) {
      nr.remove();
    }
  }

  function renderCatalog(modules) {
    let body = '<div class="mcu-catalog-body">';
    for (const mod of modules) {
      const theme = I.MODULE_THEME[mod.id] || { color: "#e8913a", label: mod.marker };
      const openCls = isGroupExpanded(mod.id) ? " open" : "";
      body +=
        '<div class="mcu-accordion' +
        openCls +
        '" data-module="' +
        esc(mod.id) +
        '" data-state-id="' +
        esc(mod.id) +
        '" style="--mod-accent:' +
        esc(theme.color) +
        '">' +
        '<div class="mcu-accordion-header draggable" data-template="' +
        esc(mod.template) +
        '">' +
        '<span class="mcu-chevron" data-action="toggle">' +
        I.getIcon("chevron") +
        "</span>" +
        '<span class="mcu-module-icon">' +
        esc(theme.label) +
        "</span>" +
        '<span class="mcu-module-title">' +
        esc(mod.title) +
        "</span>" +
        '<span class="mcu-marker">' +
        esc(mod.marker) +
        "</span></div>" +
        '<div class="mcu-accordion-body">';
      for (const group of mod.cardGroups || []) {
        body += '<div class="mcu-group-title">' + esc(group.title) + "</div>";
        body += '<div class="mcu-card-grid">';
        for (const card of group.items || []) {
          body +=
            '<div class="mcu-card" data-label="' +
            esc(card.label) +
            '" data-search="' +
            esc((card.label + " " + card.title).toLowerCase()) +
            '">' +
            '<span class="mcu-card-label">' +
            esc(card.label) +
            "</span>" +
            '<span class="mcu-card-title">' +
            esc(card.title) +
            "</span>" +
            I.getIcon("drag") +
            '<div class="mcu-card-detail">' +
            (card.syntax
              ? '<div class="mcu-card-syntax">' + esc(card.syntax) + "</div>"
              : "") +
            (card.description
              ? '<div class="mcu-card-desc">' + esc(card.description) + "</div>"
              : "") +
            (card.example
              ? '<div class="mcu-card-example">' + esc(card.example) + "</div>"
              : "") +
            "</div></div>";
        }
        body += "</div>";
      }
      body += "</div></div>";
    }
    body += "</div>";

    root.innerHTML = panelShellOpen(state.panel) + catalogSearchHtml() + body + "</div>";

    const searchEl = document.getElementById("mcu-search");
    if (searchEl) {
      searchEl.value = state.filter || "";
      searchEl.addEventListener("input", () => {
        state.filter = searchEl.value;
        applyCatalogFilter(state.filter);
      });
    }

    root.querySelectorAll(".mcu-accordion").forEach((accordion) => {
      const header = accordion.querySelector(".mcu-accordion-header");
      const template = header.getAttribute("data-template");
      bindDrag(header, template, "plain");

      header.addEventListener("dblclick", (e) => {
        if (e.target.closest("[data-action=toggle]")) return;
        if (template) {
          vscode.postMessage({ type: "insert", text: template, format: "plain" });
        }
      });

      header.querySelector("[data-action=toggle]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNode(accordion);
      });

      header.addEventListener("click", (e) => {
        if (e.target.closest("[data-action=toggle]")) return;
        toggleNode(accordion);
      });
    });

    root.querySelectorAll(".mcu-card").forEach((cardEl) => {
      const mod = cardEl.closest(".mcu-accordion");
      const modId = mod && mod.getAttribute("data-module");
      const modData = modules.find((m) => m.id === modId);
      if (!modData) return;
      const label = cardEl.getAttribute("data-label");
      let item = null;
      for (const g of modData.cardGroups || []) {
        item = (g.items || []).find((c) => c.label === label);
        if (item) break;
      }
      if (item) {
        bindInsert(cardEl, item.insertText, item.insertFormat);
      }
    });

    if (state.filter) applyCatalogFilter(state.filter);
  }

  function applyNavFilter(q) {
    const query = (q || "").trim().toLowerCase();
    let visibleCards = 0;
    root.querySelectorAll(".mcu-nav-card").forEach((card) => {
      const s = card.getAttribute("data-search") || "";
      const show = !query || s.includes(query);
      card.classList.toggle("mcu-hidden", !show);
      if (show) visibleCards++;
    });
    root.querySelectorAll(".mcu-nav-group").forEach((group) => {
      const s = group.getAttribute("data-search") || "";
      const hasVisibleChild =
        group.querySelectorAll(".mcu-nav-card:not(.mcu-hidden), .mcu-nav-group:not(.mcu-hidden)").length > 0;
      const selfMatch = !query || s.includes(query);
      const show = selfMatch || hasVisibleChild;
      group.classList.toggle("mcu-hidden", !show);
      if (query && selfMatch) {
        group.classList.add("open");
        const gid = group.getAttribute("data-group-id");
        if (gid) setGroupExpanded(gid, true);
      }
    });
    let nr = root.querySelector(".mcu-no-results");
    if (query && visibleCards === 0) {
      if (!nr) {
        nr = document.createElement("div");
        nr.className = "mcu-no-results";
        nr.textContent = "Ничего не найдено";
        root.querySelector(".mcu-nav-body")?.appendChild(nr);
      }
    } else if (nr) {
      nr.remove();
    }
  }

  function bindNavGroups() {
    root.querySelectorAll(".mcu-nav-group, .mcu-accordion:not(.mcu-nav-group)").forEach((accordion) => {
      const header = accordion.querySelector(":scope > .mcu-accordion-header");
      if (!header) return;
      header.querySelector("[data-action=toggle]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNode(accordion);
      });
      header.addEventListener("click", (e) => {
        if (e.target.closest("[data-action=toggle]")) return;
        toggleNode(accordion);
      });
    });
  }

  function bindNavInteractions() {
    bindNavGroups();

    root.querySelectorAll(".mcu-nav-card.leaf-clickable").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const uri = row.getAttribute("data-uri");
        const rangeStr = row.getAttribute("data-range");
        if (!uri || !rangeStr) return;
        try {
          vscode.postMessage({ type: "goTo", uri, range: JSON.parse(rangeStr) });
        } catch (_) {
          /* ignore */
        }
      });
    });
  }

  document.addEventListener("copy", (e) => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) {
      e.preventDefault();
      vscode.postMessage({ type: "copyText", text: sel });
      return;
    }
    const card = e.target?.closest?.(".mcu-nav-card");
    if (card) {
      const text = card.getAttribute("data-copy");
      if (text) {
        e.preventDefault();
        vscode.postMessage({ type: "copyText", text });
      }
    }
  });

  function renderTree(nodes) {
    if (!nodes || nodes.length === 0) {
      root.innerHTML =
        panelShellOpen(state.panel) +
        '<div class="mcu-empty">Нет данных в текущем файле</div></div>';
      return;
    }
    const accent = I.panelAccent(state.panel);
    root.innerHTML =
      panelShellOpen(state.panel) +
      navSearchHtml() +
      '<div class="mcu-nav-body mcu-catalog-body" style="--panel-accent:' +
      esc(accent) +
      '"><div class="mcu-card-grid mcu-nav-root">' +
      renderTreeNodes(nodes) +
      "</div></div></div>";

    const searchEl = document.getElementById("mcu-nav-search");
    if (searchEl) {
      searchEl.value = state.filter || "";
      searchEl.addEventListener("input", () => {
        state.filter = searchEl.value;
        applyNavFilter(state.filter);
      });
    }

    bindNavInteractions();
    if (state.filter) {
      applyNavFilter(state.filter);
    } else {
      root.querySelectorAll(".mcu-nav-group").forEach((g) => {
        const gid = g.getAttribute("data-group-id");
        if (!gid || !isGroupExpanded(gid)) g.classList.remove("open");
      });
    }
  }

  function render() {
    if (state.mode === "catalog" && state.catalog) {
      renderCatalog(state.catalog);
    } else if (state.mode === "tree" && state.tree) {
      renderTree(state.tree);
    } else if (state.mode === "empty") {
      renderEmpty(state.message);
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.panel) {
      if (msg.panel !== state.panel) state.filter = "";
      state.panel = msg.panel;
    }
    if (msg.type === "catalog") {
      state = { ...state, mode: "catalog", catalog: msg.modules, tree: null };
      render();
    } else if (msg.type === "tree") {
      state = { ...state, mode: "tree", tree: msg.nodes, catalog: null };
      render();
    } else if (msg.type === "empty") {
      state = { ...state, mode: "empty", message: msg.message, catalog: null, tree: null };
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
