/* global acquireVsCodeApi */
(function () {
const vscode = acquireVsCodeApi();

function readLiveMode() {
  const bootEl = document.getElementById("bg-boot");
  if (!bootEl || !bootEl.textContent) return false;
  try {
    const boot = JSON.parse(bootEl.textContent);
    return boot && boot.mode === "live";
  } catch (err) {
    return false;
  }
}

const liveMode = readLiveMode();
if (liveMode) document.body.classList.add("bg-live");

const els = {
  docLabel: document.getElementById("docLabel"),
  bodyType: document.getElementById("bodyType"),
  typeCount: document.getElementById("typeCount"),
  typeDesc: document.getElementById("typeDesc"),
  name: document.getElementById("name"),
  autoNameHint: document.getElementById("autoNameHint"),
  params: document.getElementById("params"),
  nearbyCount: document.getElementById("nearbyCount"),
  nearestInfo: document.getElementById("nearestInfo"),
  warnings: document.getElementById("warnings"),
  preview: document.getElementById("preview"),
  neighborInfo: document.getElementById("neighborInfo"),
  btnInsert: document.getElementById("btnInsert"),
  btnRefresh: document.getElementById("btnRefresh"),
  sliceXY: document.getElementById("sliceXY"),
  sliceXZ: document.getElementById("sliceXZ"),
  sliceYZ: document.getElementById("sliceYZ"),
  capXY: document.getElementById("capXY"),
  capXZ: document.getElementById("capXZ"),
  capYZ: document.getElementById("capYZ"),
  idleHint: document.getElementById("idleHint"),
  sliceVisBar: document.getElementById("sliceVisBar"),
  slicesRoot: document.getElementById("slicesRoot"),
  sliceControlZ: document.getElementById("sliceControlZ"),
  sliceControlY: document.getElementById("sliceControlY"),
  sliceControlX: document.getElementById("sliceControlX"),
};

const SLICE_SLOTS = ["xy", "xz", "yz"];
const CONTROL_HOST_BY_AXIS = {
  z: () => els.sliceControlZ,
  y: () => els.sliceControlY,
  x: () => els.sliceControlX,
};

let types = [];
let constants = [];
let currentFields = [];
let slices = [];
let currentPreviewKind = "body";
let liveSlicePlanes = null;
let sliceVisibility = { xy: true, xz: true, yz: true };

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 40;
const HOVER_PX = 7;

const sliceSlots = [
  { canvas: els.sliceXY, cap: els.capXY, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null },
  { canvas: els.sliceXZ, cap: els.capXZ, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null },
  { canvas: els.sliceYZ, cap: els.capYZ, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null },
];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function fmtPlaneValue(n) {
  return Number.isFinite(n) ? Number(n).toFixed(3) : "—";
}

function postSlicePlanesChanged() {
  if (!liveSlicePlanes) return;
  vscode.postMessage({
    type: "slicePlanesChanged",
    positions: {
      x: liveSlicePlanes.x.value,
      y: liveSlicePlanes.y.value,
      z: liveSlicePlanes.z.value,
    },
  });
  requestSliceDraw();
}

function syncPlaneControlUi(axis, opts) {
  if (!liveSlicePlanes || !liveSlicePlanes[axis]) return;
  const plane = liveSlicePlanes[axis];
  const root = document.querySelector(`.bg-slice-control[data-axis="${axis}"]`);
  if (!root) return;
  const range = root.querySelector('input[type="range"]');
  const num = root.querySelector("input.bg-slice-value");
  const source = opts && opts.source;
  if (range && source !== "range" && document.activeElement !== range) {
    range.min = String(plane.min);
    range.max = String(plane.max);
    range.value = String(plane.value);
  }
  if (num && source !== "number" && document.activeElement !== num) {
    num.min = String(plane.min);
    num.max = String(plane.max);
    num.value = fmtPlaneValue(plane.value);
  } else if (num && source === "number") {
    num.value = fmtPlaneValue(plane.value);
  }
}

function setPlaneValue(axis, rawValue, opts) {
  if (!liveSlicePlanes || !liveSlicePlanes[axis]) return false;
  const plane = liveSlicePlanes[axis];
  // Number("") === 0 — пустое/пробельное поле отклоняем, иначе плоскость прыгает в 0.
  const text = String(rawValue ?? "").trim();
  if (!text) return false;
  let value = Number(text);
  if (!Number.isFinite(value)) return false;
  value = clamp(value, plane.min, plane.max);
  plane.value = value;
  syncPlaneControlUi(axis, opts || {});
  if (!(opts && opts.silent)) postSlicePlanesChanged();
  return true;
}

function commitPlaneNumberInput(input) {
  const axis = input.getAttribute("data-axis");
  if (!axis || !liveSlicePlanes || !liveSlicePlanes[axis]) return;
  const ok = setPlaneValue(axis, input.value, { source: "number" });
  if (!ok) {
    input.value = fmtPlaneValue(liveSlicePlanes[axis].value);
  }
}

function hexToRgba(hex, alpha) {
  const h = String(hex || "").trim();
  if (!h) return `rgba(61,154,139,${alpha})`;
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return `rgba(61,154,139,${alpha})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function collectSlicePlanePositions() {
  if (liveSlicePlanes) {
    return {
      x: liveSlicePlanes.x.value,
      y: liveSlicePlanes.y.value,
      z: liveSlicePlanes.z.value,
    };
  }
  const planes = {};
  for (const s of slices) {
    if (s && s.axis && Number.isFinite(s.position)) {
      planes[s.axis] = s.position;
    }
  }
  return planes;
}

function drawCutPlaneMarkers(ctx, slice, map, bounds, planes, strokeColor, canvasW, canvasH) {
  if (!slice || !slice.axis || !planes) return;
  const axis = slice.axis;
  const w = Number.isFinite(canvasW) ? canvasW : 0;
  const h = Number.isFinite(canvasH) ? canvasH : 0;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = strokeColor || "rgba(255, 236, 0, 0.92)";

  // Линии до краёв webview (canvas), не только до рамки bounds.
  const drawVertical = (u) => {
    if (!Number.isFinite(u)) return;
    const x = map(u, bounds.vMin).x;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  };
  const drawHorizontal = (v) => {
    if (!Number.isFinite(v)) return;
    const y = map(bounds.uMin, v).y;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  };

  if (axis === "z") {
    drawVertical(planes.x);
    drawHorizontal(planes.y);
  } else if (axis === "y") {
    drawVertical(planes.x);
    drawHorizontal(planes.z);
  } else if (axis === "x") {
    drawVertical(planes.y);
    drawHorizontal(planes.z);
  }
  ctx.restore();
}

function clearSliceControlHosts() {
  ["z", "y", "x"].forEach((axis) => {
    const host = CONTROL_HOST_BY_AXIS[axis] && CONTROL_HOST_BY_AXIS[axis]();
    if (host) host.innerHTML = "";
  });
}

function bindSliceControlEvents(root) {
  if (!root) return;
  const range = root.querySelector('input[type="range"]');
  const num = root.querySelector("input.bg-slice-value");
  if (range && !range.dataset.bound) {
    range.dataset.bound = "1";
    range.addEventListener("input", () => {
      const axis = range.getAttribute("data-axis");
      if (!axis) return;
      setPlaneValue(axis, range.value, { source: "range" });
    });
  }
  if (num && !num.dataset.bound) {
    num.dataset.bound = "1";
    num.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPlaneNumberInput(num);
        num.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        const axis = num.getAttribute("data-axis");
        if (axis && liveSlicePlanes && liveSlicePlanes[axis]) {
          num.value = fmtPlaneValue(liveSlicePlanes[axis].value);
        }
        num.blur();
      }
    });
    num.addEventListener("change", () => commitPlaneNumberInput(num));
    num.addEventListener("blur", () => commitPlaneNumberInput(num));
    num.addEventListener("click", (e) => e.stopPropagation());
  }
}

function renderSliceControls() {
  if (!liveSlicePlanes) {
    clearSliceControlHosts();
    return;
  }
  const items = [
    { axis: "z", label: "XY @ Z", min: liveSlicePlanes.z.min, max: liveSlicePlanes.z.max, value: liveSlicePlanes.z.value },
    { axis: "y", label: "XZ @ Y", min: liveSlicePlanes.y.min, max: liveSlicePlanes.y.max, value: liveSlicePlanes.y.value },
    { axis: "x", label: "YZ @ X", min: liveSlicePlanes.x.min, max: liveSlicePlanes.x.max, value: liveSlicePlanes.x.value },
  ];

  items.forEach((it) => {
    const host = CONTROL_HOST_BY_AXIS[it.axis] && CONTROL_HOST_BY_AXIS[it.axis]();
    if (!host) return;
    let root = host.querySelector(`.bg-slice-control[data-axis="${it.axis}"]`);
    if (!root) {
      host.innerHTML = `
        <label class="bg-slice-control" data-axis="${it.axis}">
          <span class="bg-slice-control-label">
            ${it.label}:
            <input class="bg-slice-value" type="number" inputmode="decimal" step="any"
              min="${it.min}" max="${it.max}" value="${fmtPlaneValue(it.value)}" data-axis="${it.axis}" title="Точное положение плоскости" />
          </span>
          <input type="range" min="${it.min}" max="${it.max}" step="any" value="${it.value}" data-axis="${it.axis}" />
        </label>
      `;
      root = host.querySelector(`.bg-slice-control[data-axis="${it.axis}"]`);
      bindSliceControlEvents(root);
    }
    liveSlicePlanes[it.axis].min = it.min;
    liveSlicePlanes[it.axis].max = it.max;
    liveSlicePlanes[it.axis].value = it.value;
    syncPlaneControlUi(it.axis, {});
  });
}

function normalizeSliceVisibility(raw) {
  return {
    xy: !(raw && raw.xy === false),
    xz: !(raw && raw.xz === false),
    yz: !(raw && raw.yz === false),
  };
}

function visibleSliceCount() {
  return SLICE_SLOTS.reduce((n, slot) => n + (sliceVisibility[slot] ? 1 : 0), 0);
}

function persistSliceVisibility() {
  vscode.postMessage({
    type: "sliceVisibilityChanged",
    visibility: { ...sliceVisibility },
  });
}

function applySliceVisibility() {
  if (!visibleSliceCount()) sliceVisibility.xy = true;
  SLICE_SLOTS.forEach((slot) => {
    const on = !!sliceVisibility[slot];
    const panel = document.querySelector(`.bg-slice-panel[data-slot="${slot}"]`);
    const btn = els.sliceVisBar && els.sliceVisBar.querySelector(`.bg-slice-vis-btn[data-slot="${slot}"]`);
    if (panel) panel.classList.toggle("is-hidden", !on);
    if (btn) {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  });
  if (els.slicesRoot) {
    els.slicesRoot.style.setProperty("--bg-slice-visible", String(Math.max(1, visibleSliceCount())));
  }
  requestSliceDraw();
}

function toggleSliceVisibility(slot) {
  if (!SLICE_SLOTS.includes(slot)) return;
  const next = !sliceVisibility[slot];
  if (!next && visibleSliceCount() <= 1) return;
  sliceVisibility[slot] = next;
  applySliceVisibility();
  persistSliceVisibility();
}

function initSliceVisibilityUi(bootVisibility) {
  sliceVisibility = normalizeSliceVisibility(bootVisibility);
  applySliceVisibility();
  if (!els.sliceVisBar || els.sliceVisBar.dataset.bound) return;
  els.sliceVisBar.dataset.bound = "1";
  els.sliceVisBar.querySelectorAll(".bg-slice-vis-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = btn.getAttribute("data-slot");
      if (slot) toggleSliceVisibility(slot);
    });
  });
}

function resetSliceView(slot) {
  slot.view = { zoom: 1, panX: 0, panY: 0 };
  slot.hoverName = null;
}

function hideTip(slot) {
  if (slot.tip) {
    slot.tip.classList.remove("visible");
    slot.tip.textContent = "";
  }
}

function canvasLocal(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function screenToUv(slot, x, y) {
  const c = slot.cam;
  const v = slot.view;
  if (!c || !v || !(c.fitScale * v.zoom)) return null;
  const scale = c.fitScale * v.zoom;
  return {
    u: c.uMin + (x - c.ox - v.panX) / scale,
    v: c.vMin + (c.cssH - c.oy - v.panY - y) / scale,
  };
}

function distPointSeg(p, a, b) {
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-24) return Math.hypot(p.u - a.u, p.v - a.v);
  let t = ((p.u - a.u) * dx + (p.v - a.v) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.u - (a.u + t * dx), p.v - (a.v + t * dy));
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].v;
    const yj = pts[j].v;
    const xi = pts[i].u;
    const xj = pts[j].u;
    if ((yi > p.v) !== (yj > p.v) && p.u < ((xj - xi) * (p.v - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].u * pts[i].v - pts[i].u * pts[j].v;
  }
  return Math.abs(a) * 0.5;
}

function pickGrayBody(slot, uv) {
  const slice = slot.slice;
  const cam = slot.cam;
  if (!slice || !cam || !uv) return null;
  const scale = cam.fitScale * slot.view.zoom;
  if (!scale) return null;
  const thresh = HOVER_PX / scale;
  let bestName = null;
  let bestArea = Infinity;
  let bestDist = Infinity;
  (slice.polylines || []).forEach((pl) => {
    if (pl.highlight || !pl.name || !pl.points || pl.points.length < 2) return;
    const pts = pl.points;
    let dmin = Infinity;
    for (let i = 1; i < pts.length; i++) {
      dmin = Math.min(dmin, distPointSeg(uv, pts[i - 1], pts[i]));
    }
    if (pl.closed) dmin = Math.min(dmin, distPointSeg(uv, pts[pts.length - 1], pts[0]));
    const inside = pl.closed && pointInPoly(uv, pts);
    if (!inside && dmin > thresh) return;
    const area = inside ? polygonArea(pts) : Infinity;
    if (area < bestArea || (area === bestArea && dmin < bestDist)) {
      bestName = pl.name;
      bestArea = area;
      bestDist = dmin;
    }
  });
  return bestName;
}

function pickGridZone(slot, uv) {
  const slice = slot.slice;
  if (!slice || !slice.grid || !slice.bounds || !uv) return null;
  const rows = slice.grid.length;
  const cols = rows ? slice.grid[0].length : 0;
  if (!rows || !cols) return null;
  const b = slice.bounds;
  if (uv.u < b.uMin || uv.u > b.uMax || uv.v < b.vMin || uv.v > b.vMax) return null;
  const col = clamp(Math.floor(((uv.u - b.uMin) / (b.uMax - b.uMin || 1)) * cols), 0, cols - 1);
  const row = clamp(Math.floor(((b.vMax - uv.v) / (b.vMax - b.vMin || 1)) * rows), 0, rows - 1);
  const idx = slice.grid[row] && slice.grid[row][col];
  if (!idx) return null;
  const meta = (slice.zoneIndex || []).find((z) => z.index === idx);
  return meta && meta.name ? meta.name : null;
}

function pickSliceName(slot, uv) {
  const slice = slot.slice;
  if (slice && slice.zonePreview && slice.polylines && slice.polylines.length) return pickGrayBody(slot, uv);
  if (slice && slice.grid) return pickGridZone(slot, uv);
  return pickGrayBody(slot, uv);
}

function placeTip(slot, clientX, clientY) {
  const wrap = slot.canvas && slot.canvas.parentElement;
  if (!slot.tip || !wrap || !slot.hoverName) {
    hideTip(slot);
    return;
  }
  const r = wrap.getBoundingClientRect();
  slot.tip.textContent = slot.hoverName;
  slot.tip.classList.add("visible");
  let x = clientX - r.left + 12;
  let y = clientY - r.top + 10;
  const tw = slot.tip.offsetWidth;
  const th = slot.tip.offsetHeight;
  if (x + tw > r.width - 4) x = clientX - r.left - tw - 10;
  if (y + th > r.height - 4) y = clientY - r.top - th - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  slot.tip.style.left = x + "px";
  slot.tip.style.top = y + "px";
}

function setCanvasCursor(slot) {
  const canvas = slot.canvas;
  if (!canvas) return;
  canvas.classList.toggle("is-panning", !!slot.drag);
  canvas.classList.toggle("is-hover", !slot.drag && !!slot.hoverName);
}

function readForm() {
  const params = currentFields.map((_, i) => {
    const input = document.getElementById("param_" + i);
    return input ? input.value.trim() : "";
  });
  return {
    bodyType: els.bodyType.value,
    name: sanitizeBodyName(els.name.value),
    params,
    nearbyCount: Number(els.nearbyCount.value) || 12,
  };
}

function sendPreview() {
  vscode.postMessage({ type: "preview", form: readForm() });
}

function sanitizeBodyName(raw) {
  const s = String(raw || "").replace(/\s+/g, "");
  if (s === "*") return "*";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (out.length >= 6) break;
    if (out.length === 0) {
      if (/[A-Za-z]/.test(ch)) out += ch;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

function isValidBodyName(name) {
  if (name === "*") return true;
  if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(name)) return false;
  const u = name.toUpperCase();
  return u !== "T" && u !== "U";
}

function fillTypes(list, selected) {
  types = list || [];
  if (!els.bodyType) return;
  const sel = selected || els.bodyType.value || (types[0] && types[0].key) || "RCZ";
  els.bodyType.innerHTML = "";
  types.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.key;
    opt.textContent = t.key + " — " + t.title;
    els.bodyType.appendChild(opt);
  });
  if (types.some((t) => t.key === sel)) els.bodyType.value = sel;
  else if (types[0]) els.bodyType.value = types[0].key;
  if (els.typeCount) els.typeCount.textContent = "(" + types.length + ")";
}

function fillEquList() {
  const dl = document.getElementById("equList");
  if (!dl) return;
  dl.innerHTML = "";
  constants.forEach((c) => {
    const opt = document.createElement("option");
    const val = c.value != null && Number.isFinite(c.value) ? " = " + c.value : "";
    opt.value = c.name;
    opt.label = c.name + val;
    dl.appendChild(opt);
  });
}

let paramTipEl = null;

function ensureParamTip() {
  if (paramTipEl) return paramTipEl;
  paramTipEl = document.createElement("div");
  paramTipEl.className = "bg-field-tip";
  paramTipEl.setAttribute("role", "tooltip");
  document.body.appendChild(paramTipEl);
  return paramTipEl;
}

function showParamTip(text, clientX, clientY) {
  if (!text) return;
  const tip = ensureParamTip();
  tip.textContent = text;
  tip.classList.add("visible");
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let x = clientX + 12;
  let y = clientY + 14;
  if (x + tw > window.innerWidth - 8) x = clientX - tw - 10;
  if (y + th > window.innerHeight - 8) y = clientY - th - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function hideParamTip() {
  if (paramTipEl) paramTipEl.classList.remove("visible");
}

function bindParamHint(el, text) {
  if (!el || !text) return;
  el.classList.add("has-hint");
  el.addEventListener("pointerenter", (e) => showParamTip(text, e.clientX, e.clientY));
  el.addEventListener("pointermove", (e) => showParamTip(text, e.clientX, e.clientY));
  el.addEventListener("pointerleave", hideParamTip);
  el.addEventListener("blur", hideParamTip);
}

function rebuildParams(fields, values) {
  currentFields = fields || [];
  hideParamTip();
  if (!els.params) return;
  els.params.innerHTML = "";
  currentFields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "bg-param-row";
    const lab = document.createElement("label");
    lab.textContent = f.label;
    lab.setAttribute("for", "param_" + i);
    const input = document.createElement("input");
    input.id = "param_" + i;
    input.setAttribute("list", "equList");
    input.value = values && values[i] != null ? values[i] : f.defaultValue;
    input.placeholder = f.defaultValue;
    input.addEventListener("input", () => sendPreview());
    input.addEventListener("change", () => sendPreview());
    bindParamHint(lab, f.hint);
    bindParamHint(input, f.hint);
    row.appendChild(lab);
    row.appendChild(input);
    els.params.appendChild(row);
  });
  fillEquList();
}

function onTypeChange(keepValues) {
  const key = els.bodyType.value;
  const t = types.find((x) => x.key === key);
  if (!t) return;
  els.typeDesc.textContent = t.description || "";
  const prev = keepValues ? readForm().params : null;
  const values = t.fields.map((f, i) =>
    prev && prev[i] != null && prev[i] !== "" ? prev[i] : f.defaultValue
  );
  rebuildParams(t.fields, values);
  sendPreview();
}

function renderWarnings(list) {
  if (!els.warnings) return;
  els.warnings.innerHTML = "";
  (list || []).forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    els.warnings.appendChild(li);
  });
}

function drawOneSlice(slot, slice) {
  if (!slot || !slot.canvas) return;
  const canvas = slot.canvas;
  slot.slice = slice || null;
  if (slot.cap) slot.cap.textContent = slice && slice.title ? slice.title : "—";
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  if (!ctx || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, wrap.clientWidth);
  const cssH = Math.max(1, wrap.clientHeight);
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#11111b";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!slice || !slice.bounds) {
    slot.cam = null;
    hideTip(slot);
    return;
  }

  const view = slot.view || { zoom: 1, panX: 0, panY: 0 };
  slot.view = view;
  const b = slice.bounds;
  const du = b.uMax - b.uMin || 1;
  const dv = b.vMax - b.vMin || 1;
  const pad = 22;
  const innerW = cssW - 2 * pad;
  const innerH = cssH - 2 * pad;
  const fitScale = Math.min(innerW / du, innerH / dv);
  const ox = pad + (innerW - du * fitScale) / 2;
  const oy = pad + (innerH - dv * fitScale) / 2;
  const scale = fitScale * view.zoom;
  slot.cam = { uMin: b.uMin, vMin: b.vMin, fitScale, ox, oy, cssW, cssH };

  function map(u, v) {
    return {
      x: ox + view.panX + (u - b.uMin) * scale,
      y: cssH - oy - view.panY - (v - b.vMin) * scale,
    };
  }

  function drawHatchWithinCurrentPath(color) {
    ctx.save();
    ctx.clip("evenodd");
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const hatchSpacing = 8;
    for (let x = -cssH; x < cssW + cssH; x += hatchSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + cssH, cssH);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSlicePlaneMarkers() {
    const planes = collectSlicePlanePositions();
    drawCutPlaneMarkers(ctx, slice, map, b, planes, "rgba(255, 236, 0, 0.92)", cssW, cssH);
  }

  function drawGridOverlay(rows, cols) {
    if (!rows || !cols) return;
    ctx.save();
    ctx.strokeStyle = "rgba(190,190,190,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 0; col <= cols; col++) {
      const u = b.uMin + (du * col) / cols;
      const p0 = map(u, b.vMin);
      const p1 = map(u, b.vMax);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    for (let row = 0; row <= rows; row++) {
      const v = b.vMax - (dv * row) / rows;
      const p0 = map(b.uMin, v);
      const p1 = map(b.uMax, v);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();

  const frame = [map(b.uMin, b.vMin), map(b.uMax, b.vMax)];
  ctx.strokeStyle = "#313244";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.min(frame[0].x, frame[1].x),
    Math.min(frame[0].y, frame[1].y),
    Math.abs(frame[1].x - frame[0].x),
    Math.abs(frame[1].y - frame[0].y)
  );

  ctx.strokeStyle = "#45475a";
  ctx.beginPath();
  const ax0 = map(0, b.vMin);
  const ax1 = map(0, b.vMax);
  ctx.moveTo(ax0.x, ax0.y);
  ctx.lineTo(ax1.x, ax1.y);
  const ay0 = map(b.uMin, 0);
  const ay1 = map(b.uMax, 0);
  ctx.moveTo(ay0.x, ay0.y);
  ctx.lineTo(ay1.x, ay1.y);
  ctx.stroke();

  const hoverName = slot.hoverName;
  if (slice.zonePreview && slice.polylines && slice.polylines.length) {
    const rows = slice.grid && slice.grid.length ? slice.grid.length : 0;
    const cols = rows ? slice.grid[0].length : 0;
    drawGridOverlay(rows, cols);
    if (slice.segments && slice.segments.length) {
      ctx.save();
      ctx.strokeStyle = "#3d9a8b";
      ctx.lineWidth = hoverName ? 2.1 : 1.5;
      ctx.beginPath();
      (slice.segments || []).forEach((seg) => {
        if (!seg || !seg.a || !seg.b) return;
        const p1 = map(seg.a.u, seg.a.v);
        const p2 = map(seg.b.u, seg.b.v);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      });
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    // Важно: ctx.fill("evenodd") неявно замыкает open-contours,
    // поэтому заполняем только действительно closed контуры.
    (slice.polylines || [])
      .filter((pl) => pl && pl.closed)
      .forEach((pl) => {
        if (!pl.points || !pl.points.length) return;
      pl.points.forEach((p, i) => {
        const q = map(p.u, p.v);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
        ctx.closePath();
      });
    ctx.fillStyle = hoverName ? "rgba(205,214,244,0.18)" : "rgba(61,154,139,0.18)";
    ctx.fill("evenodd");
    const zoneName = slice.zoneIndex && slice.zoneIndex[1] && slice.zoneIndex[1].name;
    const zoneColor = slice.zoneIndex && slice.zoneIndex[1] && slice.zoneIndex[1].color ? slice.zoneIndex[1].color : "#3d9a8b";
    ctx.beginPath();
    (slice.polylines || [])
      .filter((pl) => pl && pl.closed && (zoneName ? pl.name === zoneName : true))
      .forEach((pl) => {
        if (!pl.points || !pl.points.length) return;
        pl.points.forEach((p, i) => {
          const q = map(p.u, p.v);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.closePath();
      });
    drawHatchWithinCurrentPath(hexToRgba(zoneColor, 0.26));

    (slice.polylines || []).forEach((pl) => {
      if (!pl.points || pl.points.length < 2) return;
      const hovered = hoverName && pl.name === hoverName;
      ctx.beginPath();
      pl.points.forEach((p, i) => {
        const q = map(p.u, p.v);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      if (pl.closed) ctx.closePath();
      ctx.strokeStyle = hovered ? "#cdd6f4" : (pl.color || "#3d9a8b");
      ctx.lineWidth = hovered ? 2.2 : 1.5;
      ctx.stroke();
    });
    drawSlicePlaneMarkers();
    ctx.restore();
    ctx.fillStyle = "#9d9d9d";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(slice.uLabel || "U", cssW - 18, cssH - 6);
    ctx.fillText(slice.vLabel || "V", 6, 14);
    return;
  }
  if (slice.grid) {
    const rows = slice.grid.length || 0;
    const cols = rows ? slice.grid[0].length : 0;
    drawGridOverlay(rows, cols);
    const duCell = cols ? du / cols : 0;
    const dvCell = rows ? dv / rows : 0;
    const zoneColorByIndex = new Map((slice.zoneIndex || []).map((z) => [z.index, z.color || "#3d9a8b"]));
    for (let row = 0; row < rows; row++) {
      const vTop = b.vMax - row * dvCell;
      const vBottom = vTop - dvCell;
      for (let col = 0; col < cols; col++) {
        const idx = slice.grid[row][col];
        if (!idx) continue;
        const uLeft = b.uMin + col * duCell;
        const uRight = uLeft + duCell;
        const p1 = map(uLeft, vTop);
        const p2 = map(uRight, vBottom);
        ctx.fillStyle = idx && hoverName === ((slice.zoneIndex || []).find((z) => z.index === idx) || {}).name
          ? "rgba(205,214,244,0.30)"
          : "rgba(61,154,139,0.28)";
        ctx.fillRect(
          Math.min(p1.x, p2.x),
          Math.min(p1.y, p2.y),
          Math.max(1, Math.abs(p2.x - p1.x)),
          Math.max(1, Math.abs(p2.y - p1.y))
        );
      }
    }

    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      const vTop = b.vMax - row * dvCell;
      const vBottom = vTop - dvCell;
      for (let col = 0; col < cols; col++) {
        const idx = slice.grid[row][col];
        if (!idx) continue;
        const uLeft = b.uMin + col * duCell;
        const uRight = uLeft + duCell;
        const p1 = map(uLeft, vTop);
        const p2 = map(uRight, vBottom);
        ctx.rect(
          Math.min(p1.x, p2.x),
          Math.min(p1.y, p2.y),
          Math.max(1, Math.abs(p2.x - p1.x)),
          Math.max(1, Math.abs(p2.y - p1.y))
        );
      }
    }
    drawHatchWithinCurrentPath(hoverName ? "rgba(205,214,244,0.24)" : "rgba(61,154,139,0.20)");

    ctx.strokeStyle = "#3d9a8b";
    ctx.lineWidth = hoverName ? 1.8 : 1.25;
    ctx.beginPath();
    const cellAt = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : (slice.grid[r] && slice.grid[r][c]) || 0);
    for (let row = 0; row < rows; row++) {
      const vTop = b.vMax - row * dvCell;
      const vBottom = vTop - dvCell;
      for (let col = 0; col < cols; col++) {
        const idx = cellAt(row, col);
        if (!idx) continue;
        const uLeft = b.uMin + col * duCell;
        const uRight = uLeft + duCell;
        if (!cellAt(row - 1, col)) {
          const a = map(uLeft, vTop);
          const bb = map(uRight, vTop);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bb.x, bb.y);
        }
        if (!cellAt(row + 1, col)) {
          const a = map(uLeft, vBottom);
          const bb = map(uRight, vBottom);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bb.x, bb.y);
        }
        if (!cellAt(row, col - 1)) {
          const a = map(uLeft, vTop);
          const bb = map(uLeft, vBottom);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bb.x, bb.y);
        }
        if (!cellAt(row, col + 1)) {
          const a = map(uRight, vTop);
          const bb = map(uRight, vBottom);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bb.x, bb.y);
        }
      }
    }
    ctx.stroke();
    drawSlicePlaneMarkers();
    ctx.restore();
    ctx.fillStyle = "#9d9d9d";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(slice.uLabel || "U", cssW - 18, cssH - 6);
    ctx.fillText(slice.vLabel || "V", 6, 14);
    return;
  }
  const ordered = (slice.polylines || []).slice().sort((a, b2) => {
    const ah = a.highlight ? 1 : 0;
    const bh = b2.highlight ? 1 : 0;
    if (ah !== bh) return ah - bh;
    const aHov = !a.highlight && a.name === hoverName ? 1 : 0;
    const bHov = !b2.highlight && b2.name === hoverName ? 1 : 0;
    return aHov - bHov;
  });
  ordered.forEach((pl) => {
    if (!pl.points || !pl.points.length) return;
    const hovered = !pl.highlight && hoverName && pl.name === hoverName;
    ctx.beginPath();
    pl.points.forEach((p, i) => {
      const q = map(p.u, p.v);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    if (pl.closed) ctx.closePath();
    if (pl.highlight) {
      ctx.fillStyle = "rgba(61,154,139,0.22)";
      ctx.fill();
      ctx.strokeStyle = pl.color || "#3d9a8b";
      ctx.lineWidth = 2;
    } else if (hovered) {
      ctx.fillStyle = "rgba(166,173,200,0.14)";
      if (pl.closed) ctx.fill();
      ctx.strokeStyle = "#cdd6f4";
      ctx.lineWidth = 2.15;
    } else {
      ctx.strokeStyle = pl.color || "#585b70";
      ctx.lineWidth = 1.05;
    }
    ctx.stroke();
  });
  drawSlicePlaneMarkers();
  ctx.restore();

  ctx.fillStyle = "#9d9d9d";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(slice.uLabel || "U", cssW - 18, cssH - 6);
  ctx.fillText(slice.vLabel || "V", 6, 14);
}

function drawSlices() {
  sliceSlots.forEach((slot, i) => {
    const slotId = SLICE_SLOTS[i];
    if (slotId && !sliceVisibility[slotId]) return;
    drawOneSlice(slot, slices[i] || null);
  });
}

let navRaf = 0;
function requestSliceDraw() {
  if (navRaf) return;
  navRaf = requestAnimationFrame(() => {
    navRaf = 0;
    drawSlices();
  });
}

function attachSliceNav(slot) {
  const canvas = slot.canvas;
  if (!canvas || canvas.dataset.navBound) return;
  canvas.dataset.navBound = "1";
  const wrap = canvas.parentElement;
  if (wrap) {
    const tip = document.createElement("div");
    tip.className = "bg-slice-tip";
    wrap.appendChild(tip);
    slot.tip = tip;
  }

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!slot.cam) return;
    const loc = canvasLocal(canvas, e.clientX, e.clientY);
    const uv = screenToUv(slot, loc.x, loc.y);
    if (!uv) return;
    const factor = Math.pow(1.0018, -e.deltaY);
    const nextZoom = clamp(slot.view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const newScale = slot.cam.fitScale * nextZoom;
    slot.view.zoom = nextZoom;
    slot.view.panX = loc.x - slot.cam.ox - (uv.u - slot.cam.uMin) * newScale;
    slot.view.panY = slot.cam.cssH - slot.cam.oy - loc.y - (uv.v - slot.cam.vMin) * newScale;
    requestSliceDraw();
  }, { passive: false });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    slot.drag = { x: e.clientX, y: e.clientY, moved: false };
    slot.hoverName = null;
    hideTip(slot);
    setCanvasCursor(slot);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (slot.drag) {
      const dx = e.clientX - slot.drag.x;
      const dy = e.clientY - slot.drag.y;
      if (dx || dy) slot.drag.moved = true;
      slot.drag.x = e.clientX;
      slot.drag.y = e.clientY;
      slot.view.panX += dx;
      slot.view.panY -= dy;
      requestSliceDraw();
      return;
    }
    const loc = canvasLocal(canvas, e.clientX, e.clientY);
    const name = pickSliceName(slot, screenToUv(slot, loc.x, loc.y));
    if (name !== slot.hoverName) {
      slot.hoverName = name;
      drawOneSlice(slot, slot.slice);
    }
    setCanvasCursor(slot);
    if (name) placeTip(slot, e.clientX, e.clientY);
    else hideTip(slot);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (slot.drag) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      slot.drag = null;
      setCanvasCursor(slot);
    }
  });

  canvas.addEventListener("pointercancel", () => {
    slot.drag = null;
    setCanvasCursor(slot);
  });

  canvas.addEventListener("pointerleave", () => {
    if (slot.drag) return;
    if (slot.hoverName) {
      slot.hoverName = null;
      drawOneSlice(slot, slot.slice);
    }
    hideTip(slot);
    setCanvasCursor(slot);
  });

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    resetSliceView(slot);
    hideTip(slot);
    setCanvasCursor(slot);
    drawOneSlice(slot, slot.slice);
  });
}

sliceSlots.forEach(attachSliceNav);
window.addEventListener("resize", () => drawSlices());

if (els.bodyType) {
  els.bodyType.addEventListener("change", () => {
    sliceSlots.forEach(resetSliceView);
    onTypeChange(false);
  });
}

if (els.name) {
  els.name.addEventListener("beforeinput", (e) => {
    if (!e.data) return;
    if (e.data === "*") return;
    if (!/^[A-Za-z0-9]+$/.test(e.data)) e.preventDefault();
  });
  els.name.addEventListener("input", () => {
    const cleaned = sanitizeBodyName(els.name.value);
    if (els.name.value !== cleaned) els.name.value = cleaned;
    els.name.classList.toggle("invalid", cleaned.length > 0 && !isValidBodyName(cleaned));
    sendPreview();
  });
  els.name.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    els.name.value = sanitizeBodyName(text);
    els.name.dispatchEvent(new Event("input"));
  });
}
if (els.nearbyCount) els.nearbyCount.addEventListener("change", () => sendPreview());
const formEl = document.getElementById("form");
if (formEl) formEl.addEventListener("scroll", hideParamTip);
window.addEventListener("scroll", hideParamTip, true);
if (els.btnInsert) {
  els.btnInsert.addEventListener("click", () => {
    const form = readForm();
    if (!isValidBodyName(form.name)) {
      if (els.name) els.name.classList.add("invalid");
      return;
    }
    vscode.postMessage({ type: "insert", form });
  });
}
if (els.btnRefresh) {
  els.btnRefresh.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === "state") {
    if (els.docLabel) els.docLabel.textContent = msg.docLabel || "";
    if (liveMode) return;
    constants = msg.constants || [];
    fillTypes(msg.types || [], msg.form && msg.form.bodyType);
    fillEquList();
    if (msg.form) {
      els.name.value = sanitizeBodyName(msg.form.name || "*");
      els.nearbyCount.value = String(msg.form.nearbyCount || 12);
      const t = types.find((x) => x.key === els.bodyType.value);
      if (t) {
        els.typeDesc.textContent = t.description || "";
        rebuildParams(t.fields, msg.form.params);
      }
    }
  }
  if (msg.type === "preview") {
    if (msg.docLabel && els.docLabel) els.docLabel.textContent = msg.docLabel;
    if (els.idleHint) els.idleHint.textContent = "";
    if (msg.constants) {
      constants = msg.constants;
      fillEquList();
    }
    if (els.preview) els.preview.textContent = msg.text || "";
    renderWarnings(msg.warnings || []);
    if (els.autoNameHint) {
      els.autoNameHint.textContent = msg.autoName ? "вставится как " + msg.autoName : "";
    }
    if (msg.resetView) sliceSlots.forEach(resetSliceView);
    const dp = msg.draftPreview;
    const zp = msg.zonePreview;
    if (zp) {
      currentPreviewKind = "zone";
      slices = zp.slices || [];
      if (zp.bbox && zp.bbox.min && zp.bbox.max) {
        const pickPos = (axis, fallback) => {
          const s = slices.find((item) => item && item.axis === axis);
          return s && typeof s.position === "number" ? s.position : fallback;
        };
        liveSlicePlanes = {
          x: { min: zp.bbox.min.x, max: zp.bbox.max.x, value: pickPos("x", (zp.bbox.min.x + zp.bbox.max.x) / 2) },
          y: { min: zp.bbox.min.y, max: zp.bbox.max.y, value: pickPos("y", (zp.bbox.min.y + zp.bbox.max.y) / 2) },
          z: { min: zp.bbox.min.z, max: zp.bbox.max.z, value: pickPos("z", (zp.bbox.min.z + zp.bbox.max.z) / 2) },
        };
      } else {
        liveSlicePlanes = null;
      }
      renderSliceControls();
      if (els.neighborInfo) {
        const s0 = slices && slices[0];
        if (s0 && s0.debugGrid) {
          const r = s0.debugGrid.rows;
          const c = s0.debugGrid.cols;
          const step = Number(s0.debugGrid.step);
          const stepTxt = Number.isFinite(step) ? step.toPrecision(3) : "?";
          const prims = s0.debugGrid.primitiveCount ?? 0;
          const mf = s0.debugGrid.minFeature;
          const mfTxt = mf == null ? "null" : Number(mf).toPrecision(3);
          const refsFound = s0.debugGrid.refsFound ?? 0;
          const matchedInCtx = s0.debugGrid.matchedInCtx ?? 0;
          els.neighborInfo.textContent = `сетка: ${c}×${r} · step≈${stepTxt} · прим: ${prims} (matched ${matchedInCtx}/${refsFound}), min≈${mfTxt}`;
        } else {
          els.neighborInfo.textContent = "логическая зона";
        }
      }
      if (els.nearestInfo) els.nearestInfo.textContent = "сечение зоны";
      drawSlices();
    } else if (dp) {
      currentPreviewKind = "body";
      slices = dp.slices || [];
      const bb =
        dp.focusBbox && dp.focusBbox.min && dp.focusBbox.max
          ? dp.focusBbox
          : dp.bbox && dp.bbox.min && dp.bbox.max
            ? dp.bbox
            : null;
      if (bb) {
        const pickPos = (axis, fallback) => {
          const s = slices.find((item) => item && item.axis === axis);
          return s && typeof s.position === "number" ? s.position : fallback;
        };
        liveSlicePlanes = {
          x: { min: bb.min.x, max: bb.max.x, value: pickPos("x", (bb.min.x + bb.max.x) / 2) },
          y: { min: bb.min.y, max: bb.max.y, value: pickPos("y", (bb.min.y + bb.max.y) / 2) },
          z: { min: bb.min.z, max: bb.max.z, value: pickPos("z", (bb.min.z + bb.max.z) / 2) },
        };
      } else {
        liveSlicePlanes = null;
      }
      renderSliceControls();
      const n = (dp.neighborNames || []).length;
      if (els.neighborInfo) {
        els.neighborInfo.textContent = n ? "соседей: " + n + " (серым)" : "соседей в кадре нет";
      }
      if (els.nearestInfo) {
        const nearest = dp.nearest;
        if (nearest && nearest.name) {
          const gap = Number(nearest.gap);
          const gapTxt = !Number.isFinite(gap) ? "?" : gap < 1e-6 ? "пересекается" : gap.toFixed(3);
          els.nearestInfo.textContent = "ближайшее: " + nearest.name + " · " + gapTxt;
        } else {
          els.nearestInfo.textContent = "ближайшее: —";
        }
      }
      drawSlices();
    } else if (msg.resetView || !liveMode) {
      slices = [];
      currentPreviewKind = "body";
      liveSlicePlanes = null;
      renderSliceControls();
      if (els.neighborInfo) els.neighborInfo.textContent = "";
      if (els.nearestInfo) els.nearestInfo.textContent = "ближайшее: —";
      drawSlices();
    }
  }
  if (msg.type === "idle") {
    if (els.idleHint) els.idleHint.textContent = msg.message || "";
    if (msg.docLabel && els.docLabel) els.docLabel.textContent = msg.docLabel;
    return;
  }
  if (msg.type === "error") {
    renderWarnings([msg.message || "Ошибка"]);
  }
});

(function applyBoot() {
  const bootEl = document.getElementById("bg-boot");
  let boot = null;
  if (bootEl && bootEl.textContent) {
    try {
      boot = JSON.parse(bootEl.textContent);
    } catch (err) {
      renderWarnings(["Не удалось прочитать список типов: " + err]);
    }
  }
  initSliceVisibilityUi(boot && boot.sliceVisibility);
  if (!boot || boot.mode === "live") return;
  try {
    constants = boot.constants || [];
    fillTypes(boot.types || [], boot.form && boot.form.bodyType);
    if (boot.form) {
      if (els.name) els.name.value = sanitizeBodyName(boot.form.name || "*");
      if (els.nearbyCount) els.nearbyCount.value = String(boot.form.nearbyCount || 12);
    }
    const t = types.find((x) => x.key === (els.bodyType && els.bodyType.value));
    if (t) {
      if (els.typeDesc) els.typeDesc.textContent = t.description || "";
      rebuildParams(t.fields, (boot.form && boot.form.params) || t.fields.map((f) => f.defaultValue));
    }
  } catch (err) {
    renderWarnings(["Не удалось прочитать список типов: " + err]);
  }
})();

vscode.postMessage({ type: "ready" });
})();
