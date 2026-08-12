/* SVG-иконки и метаданные панелей MCU-NR sidebar */
(function (global) {
  const NS = "http://www.w3.org/2000/svg";

  function svg(pathD, viewBox, extra) {
    return (
      '<svg class="mcu-icon" viewBox="' +
      (viewBox || "0 0 16 16") +
      '" aria-hidden="true"' +
      (extra || "") +
      "><path " +
      pathD +
      "/></svg>"
    );
  }

  const ICONS = {
    chevron:
      '<svg class="mcu-icon mcu-icon-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10 8l-4 4.5" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    drag:
      '<svg class="mcu-icon mcu-icon-drag" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1.2" fill="currentColor"/><circle cx="11" cy="4" r="1.2" fill="currentColor"/><circle cx="5" cy="8" r="1.2" fill="currentColor"/><circle cx="11" cy="8" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="11" cy="12" r="1.2" fill="currentColor"/></svg>',
    search:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    catalog:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" opacity=".9"/><rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity=".5"/><rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity=".5"/><rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/></svg>',
    material:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" stroke="currentColor" fill="none" stroke-width="1.3"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/><path d="M8 3v2M8 11v2M3 8h2M11 8h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    zone:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12v8H2z" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M2 7h12M5 4V2M11 4V2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    body:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12L8 3l4 9H4z" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    constant:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><text x="3" y="12" font-size="11" font-weight="700" fill="currentColor" font-family="serif">π</text></svg>',
    net:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h12v12H2z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" stroke-width=".9" opacity=".7"/></svg>',
    lattice:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
    object:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="5" width="10" height="8" rx="1" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M6 5V3.5A2 2 0 0110 3.5V5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
    fragment:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10v3H3zM3 7h10v2H3zM3 11.5h10V14H3z" fill="currentColor" opacity=".85"/></svg>',
    folder:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5A1 1 0 013 3.5h3l1.5 1.5H13A1 1 0 0114 6v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z" fill="currentColor" opacity=".85"/></svg>',
    nuclide:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/><ellipse cx="8" cy="8" rx="6" ry="2.5" stroke="currentColor" fill="none" stroke-width="1"/><ellipse cx="8" cy="8" rx="6" ry="2.5" stroke="currentColor" fill="none" stroke-width="1" transform="rotate(60 8 8)"/><ellipse cx="8" cy="8" rx="6" ry="2.5" stroke="currentColor" fill="none" stroke-width="1" transform="rotate(120 8 8)"/></svg>',
    card:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M4 7h8M4 10h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    include:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h6.5L13 6v7.5H3V2.5z" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.5 2.5V6H13" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 9.5h5M8 7v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    empty:
      '<svg class="mcu-icon mcu-icon-empty" viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="6" width="28" height="36" rx="3" stroke="currentColor" fill="none" stroke-width="2" opacity=".35"/><path d="M16 16h16M16 24h12M16 32h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".25"/></svg>',
    error:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="#ef4444" fill="none" stroke-width="1.4"/><path d="M8 4.5v4M8 11h.01" stroke="#ef4444" stroke-width="1.6" stroke-linecap="round"/></svg>',
    warning:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6.5 11H1.5L8 2.5z" stroke="#fbbf24" fill="none" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.5h.01" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/></svg>',
    run:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M7 5.5l4 2.5-4 2.5V5.5z" fill="currentColor"/></svg>',
    debug:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5c1.5 0 2.7 1.2 2.7 2.7v1.1h1.3M8 2.5C6.5 2.5 5.3 3.7 5.3 5.2v1.1H4" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round"/><rect x="4.5" y="6" width="7" height="7" rx="2" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M6.5 9h3M8 9v2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    play:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5l8 4.5-8 4.5V3.5z" fill="currentColor"/></svg>',
    sync:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 01-8.5 3.5M3 8a5 5 0 018.5-3.5" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linecap="round"/><path d="M12.5 2.5v3h-3M3.5 13.5v-3h3" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    output:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M5 6h6M5 8.5h6M5 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    flame:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8c1.8 2.2 3.2 3.6 3.2 5.7A3.2 3.2 0 018 10.7a3.2 3.2 0 01-3.2-3.2C4.8 5.4 6.2 4 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 14.2c-2.4 0-4.2-1.5-4.2-3.6 0-1.4.8-2.5 2-3.5.3 1.2 1.1 2 2.2 2 1.1 0 1.9-.8 2.2-2 1.2 1 2 2.1 2 3.5 0 2.1-1.8 3.6-4.2 3.6z" fill="currentColor" opacity=".9"/></svg>',
    gear:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9L11 5M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    heart:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.2S2.5 9.6 2.5 5.8A2.9 2.9 0 018 4.2a2.9 2.9 0 015.5 1.6C13.5 9.6 8 13.2 8 13.2z" fill="currentColor"/></svg>',
    table:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M2 6.5h12M2 10h12M6.5 3v10M10.5 3v10" stroke="currentColor" stroke-width="1.1"/></svg>',
    droplet:
      '<svg class="mcu-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2c2.6 3.2 4.3 5.2 4.3 7.2a4.3 4.3 0 11-8.6 0c0-2 1.7-4 4.3-7.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 11.2a1.6 1.6 0 01-1.6-1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>',
  };

  const PANELS = {
    "mcuhelper.run": {
      title: "Запуск",
      icon: "run",
      accent: "#e8913a",
      hint: "Debug (Ctrl+Alt+D) · Run (Ctrl+Alt+R) · Continue (Ctrl+Alt+Shift+C) · Final (Ctrl+Alt+F) · Burnup (Ctrl+Alt+B). Пути — шестерёнка в заголовке или Ctrl+Alt+P",
    },
    "mcuhelper.catalog": {
      title: "Каталог",
      icon: "catalog",
      accent: "#e8913a",
      hint: "Перетащите карточку или модуль в редактор. Двойной клик по модулю — вставка шаблона",
    },
    "mcuhelper.lexerErrors": {
      title: "Диагностика",
      icon: "error",
      accent: "#ef4444",
      hint: "Клик по строке — переход в исходный файл",
      searchPh: "Фильтр диагностик…",
    },
    "mcuhelper.fragments": {
      title: "Навигация",
      icon: "fragment",
      accent: "#94a3b8",
      hint: "Карты, операторы и #include по фрагментам — клик к строке в варианте",
      searchPh: "Фильтр навигации…",
    },
    "mcuhelper.materials": {
      title: "Материалы",
      icon: "material",
      accent: "#e8913a",
      hint: "Клик — переход к определению · кнопка «Вода / пар» — IF97 dens H/O",
      searchPh: "Фильтр материалов…",
    },
    "mcuhelper.zones": {
      title: "Зоны",
      icon: "zone",
      accent: "#4a9eff",
      hint: "Клик — переход к зоне",
      searchPh: "Фильтр зон…",
    },
    "mcuhelper.bodies": {
      title: "Тела",
      icon: "body",
      accent: "#4a9eff",
      hint: "Клик — переход к телу",
      searchPh: "Фильтр тел…",
    },
    "mcuhelper.constants": {
      title: "Константы",
      icon: "constant",
      accent: "#fbbf24",
      hint: "Константы в области курсора (global / LCELL / CELL)",
      searchPh: "Фильтр констант…",
    },
    "mcuhelper.nets": {
      title: "Сети",
      icon: "net",
      accent: "#2dd4bf",
      hint: "Клик — переход к NET",
      searchPh: "Фильтр сетей…",
    },
    "mcuhelper.lattices": {
      title: "Решётки",
      icon: "lattice",
      accent: "#a78bfa",
      hint: "Клик — переход к LATT",
      searchPh: "Фильтр решёток…",
    },
    "mcuhelper.objects": {
      title: "Объекты",
      icon: "object",
      accent: "#2dd4bf",
      hint: "Клик — переход к объекту регистрации",
      searchPh: "Фильтр объектов…",
    },
  };

  function panelAccent(panelId) {
    return PANELS[panelId]?.accent || "#e8913a";
  }

  /** Цвета модулей MCU-NR (акцент слева + маркер). */
  const MODULE_THEME = {
    physical: { color: "#e8913a", label: "PIN" },
    geometry: { color: "#4a9eff", label: "GEO" },
    source: { color: "#a78bfa", label: "SRC" },
    registration: { color: "#2dd4bf", label: "REG" },
    burnupRegistration: { color: "#f472b6", label: "BRG" },
    trajectory: { color: "#94a3b8", label: "TRJ" },
    calculationControl: { color: "#fbbf24", label: "CAL" },
    burnup: { color: "#ef4444", label: "BURN" },
  };

  function iconForNode(node) {
    const id = node.id || "";
    if (id.startsWith("mat-") && id.includes("-n-")) return "nuclide";
    if (id.startsWith("mat-")) return "material";
    if (id.startsWith("zone-")) return "zone";
    if (id.startsWith("body-")) return "body";
    if (id.startsWith("const-")) return "constant";
    if (id.startsWith("net-")) return "net";
    if (id.startsWith("latt-")) return "lattice";
    if (id.startsWith("obj-")) return "object";
    if (id.startsWith("frag-")) return "fragment";
    if (id.startsWith("include-")) return "include";
    if (id.startsWith("scope-")) return "folder";
    if (id.startsWith("diag-errors") || id.startsWith("diag-warn") || id.startsWith("diag-other") || id.startsWith("diag-isotope")) return "folder";
    if (id.startsWith("diag-")) {
      if ((node.badges || []).includes("line-length")) return "warning";
      if ((node.badges || []).includes("warning")) return "warning";
      return "error";
    }
    if (id.startsWith("lex-errors") || id.startsWith("lex-warn") || id.startsWith("lex-other")) return "folder";
    if (node.children && node.children.length) return "folder";
    return "card";
  }

  function getIcon(name) {
    return ICONS[name] || ICONS.card;
  }

  global.McuSidebarIcons = {
    ICONS,
    PANELS,
    MODULE_THEME,
    getIcon,
    iconForNode,
    panelAccent,
  };
})(typeof window !== "undefined" ? window : globalThis);
