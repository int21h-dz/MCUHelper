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
  patternFields: document.getElementById("patternFields"),
  patternMode: document.getElementById("patternMode"),
  patternPresets: document.getElementById("patternPresets"),
  patternModeFields: document.getElementById("patternModeFields"),
  patternModeHint: document.getElementById("patternModeHint"),
  patternStatus: document.getElementById("patternStatus"),
  patternExcludeHint: document.getElementById("patternExcludeHint"),
  btnResetExclusions: document.getElementById("btnResetExclusions"),
  primPalette: document.getElementById("primPalette"),
  toolBar: document.getElementById("sliceToolBar"),
  btnToolPan: document.getElementById("btnToolPan"),
  btnToolEdit: document.getElementById("btnToolEdit"),
  btnToolExclude: document.getElementById("btnToolExclude"),
  btnToolRuler: document.getElementById("btnToolRuler"),
  cursorCoords: document.getElementById("cursorCoords"),
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
let previewMeshes = [];
let currentPreviewKind = "body";
let liveSlicePlanes = null;
let sliceVisibility = { xy: true, xz: true, yz: true };
/** @type {"pan"|"ruler"|"exclude"|"edit"|"place"} */
let toolMode = "pan";
let excludedIndices = [];
let arrayInstances = [];
/** Тип для размещения с палитры (place). */
let placeBodyType = null;
/** Активная ручка: { slot, id, kind, anchorUv } */
let editDrag = null;
let editPreviewTimer = 0;

/** Типы с интерактивными ручками на сечениях. */
const INTERACTIVE_PRIMS = [
  { key: "SPH", label: "SPH", title: "Шар" },
  { key: "RCZ", label: "RCZ", title: "Цилиндр Z" },
  { key: "RCC", label: "RCC", title: "Цилиндр" },
  { key: "RPP", label: "RPP", title: "Бокс по осям" },
  { key: "HEXX", label: "HEXX", title: "Шестигранник" },
  { key: "HEXY", label: "HEXY", title: "Шестигранник Y" },
  { key: "HEX", label: "HEX", title: "HEX" },
];

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 40;
const HOVER_PX = 7;
const SNAP_PX = 10;
/** Центры фигур — шире «магнит», иначе их перебивают вершины на контуре. */
const SNAP_CENTER_PX = 16;

const sliceSlots = [
  { canvas: els.sliceXY, cap: els.capXY, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null, ruler: null, snap: null, cursorUv: null },
  { canvas: els.sliceXZ, cap: els.capXZ, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null, ruler: null, snap: null, cursorUv: null },
  { canvas: els.sliceYZ, cap: els.capYZ, view: { zoom: 1, panX: 0, panY: 0 }, hoverName: null, cam: null, slice: null, tip: null, drag: null, ruler: null, snap: null, cursorUv: null },
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
  slot.snap = null;
  slot.cursorUv = null;
  slot.camLock = null;
}

function viewFitFrozen() {
  return !!(editDrag || toolMode === "edit" || toolMode === "place");
}

function clearAllCamLocks() {
  sliceSlots.forEach((slot) => {
    slot.camLock = null;
  });
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

function uvToScreen(slot, u, v) {
  const c = slot.cam;
  const view = slot.view;
  if (!c || !view) return null;
  const scale = c.fitScale * view.zoom;
  return {
    x: c.ox + view.panX + (u - c.uMin) * scale,
    y: c.cssH - c.oy - view.panY - (v - c.vMin) * scale,
  };
}

function fmtCoord(n) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(1);
  if (a >= 10) return n.toFixed(2);
  if (a >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

function uvToWorld(slice, uv) {
  if (!slice || !uv) return null;
  const pos = Number(slice.position);
  const p = Number.isFinite(pos) ? pos : 0;
  if (slice.axis === "z") return { x: uv.u, y: uv.v, z: p };
  if (slice.axis === "y") return { x: uv.u, y: p, z: uv.v };
  if (slice.axis === "x") return { x: p, y: uv.u, z: uv.v };
  return { x: uv.u, y: uv.v, z: p };
}

function worldDist(a, b) {
  if (!a || !b) return NaN;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function clearRuler(slot) {
  if (!slot) return;
  slot.ruler = null;
  slot.snap = null;
}

function clearAllRulers() {
  sliceSlots.forEach(clearRuler);
}

function setToolMode(mode) {
  const prev = toolMode;
  if (mode === "ruler") toolMode = "ruler";
  else if (mode === "exclude") toolMode = "exclude";
  else if (mode === "edit") toolMode = "edit";
  else if (mode === "place") toolMode = "place";
  else {
    toolMode = "pan";
    placeBodyType = null;
  }
  if (toolMode !== "place") {
    /* keep placeBodyType only in place */
  } else if (!placeBodyType && els.bodyType) placeBodyType = els.bodyType.value;
  if (els.btnToolPan) els.btnToolPan.classList.toggle("is-active", toolMode === "pan");
  if (els.btnToolEdit) els.btnToolEdit.classList.toggle("is-active", toolMode === "edit");
  if (els.btnToolExclude) els.btnToolExclude.classList.toggle("is-active", toolMode === "exclude");
  if (els.btnToolRuler) els.btnToolRuler.classList.toggle("is-active", toolMode === "ruler");
  document.body.classList.toggle("bg-tool-ruler", toolMode === "ruler");
  document.body.classList.toggle("bg-tool-exclude", toolMode === "exclude");
  document.body.classList.toggle("bg-tool-edit", toolMode === "edit" || toolMode === "place");
  if (toolMode === "pan" || toolMode === "edit") clearAllRulers();
  // Авто-fit снова только вне правки/размещения.
  if (!viewFitFrozen()) clearAllCamLocks();
  else if (prev !== toolMode && (toolMode === "edit" || toolMode === "place")) {
    // при входе в правку зафиксировать текущий кадр (не пересчитывать fit на каждом preview)
    sliceSlots.forEach((slot) => {
      if (slot.cam && slot.slice && slot.slice.bounds) {
        const b = slot.slice.bounds;
        slot.camLock = {
          fitScale: slot.cam.fitScale,
          uMin: slot.cam.uMin,
          vMin: slot.cam.vMin,
          bounds: { uMin: b.uMin, uMax: b.uMax, vMin: b.vMin, vMax: b.vMax },
        };
      }
    });
  }
  if (toolMode !== "place") renderPrimPalette();
  sliceSlots.forEach(setCanvasCursor);
  requestSliceDraw();
  updateCursorStatus(null, null, null);
}

function arrayIndexByName(name) {
  const hit = arrayInstances.find((x) => x.name === name);
  return hit ? hit.index : -1;
}

function isArrayCopyName(name) {
  const idx = arrayIndexByName(name);
  return idx >= 1;
}

function toggleExclusion(index) {
  if (index < 1) return false;
  const pos = excludedIndices.indexOf(index);
  if (pos >= 0) excludedIndices.splice(pos, 1);
  else excludedIndices.push(index);
  excludedIndices.sort((a, b) => a - b);
  syncPatternExcludeUi();
  return true;
}

function resetExclusions() {
  if (!excludedIndices.length) return;
  excludedIndices = [];
  syncPatternExcludeUi();
  sendPreview();
}

function syncPatternExcludeUi() {
  const active = patternGroup() !== "none";
  if (els.btnToolExclude) els.btnToolExclude.hidden = !active;
  if (els.patternExcludeHint) els.patternExcludeHint.hidden = !active;
  if (els.btnResetExclusions) {
    els.btnResetExclusions.hidden = !active || excludedIndices.length === 0;
  }
  if (!active) {
    excludedIndices = [];
    if (toolMode === "exclude") setToolMode("pan");
  }
}

function polylineCenters(pts, closed) {
  if (!pts || !pts.length) return [];
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < pts.length; i++) {
    const u = pts[i].u;
    const v = pts[i].v;
    su += u;
    sv += v;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const out = [{ u: (uMin + uMax) / 2, v: (vMin + vMax) / 2 }];
  out.push({ u: su / pts.length, v: sv / pts.length });
  if (closed && pts.length >= 3) {
    // центроид многоугольника (shoelace)
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const cross = pts[j].u * pts[i].v - pts[i].u * pts[j].v;
      a += cross;
      cx += (pts[j].u + pts[i].u) * cross;
      cy += (pts[j].v + pts[i].v) * cross;
    }
    if (Math.abs(a) > 1e-18) {
      out.push({ u: cx / (3 * a), v: cy / (3 * a) });
    }
  }
  return out;
}

function meshCenterToUv(mesh, slice) {
  if (!mesh || !mesh.center || !slice) return null;
  const c = mesh.center;
  if (slice.axis === "z") return { u: c.x, v: c.y };
  if (slice.axis === "y") return { u: c.x, v: c.z };
  if (slice.axis === "x") return { u: c.y, v: c.z };
  return { u: c.x, v: c.y };
}

function collectSnapCandidates(slot) {
  const slice = slot.slice;
  const out = [];
  if (!slice) return out;
  const add = (u, v, kind, priority) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    out.push({ u: u, v: v, kind: kind, priority: priority || 0 });
  };
  (slice.polylines || []).forEach((pl) => {
    const pts = pl && pl.points;
    if (!pts || pts.length < 1) return;
    for (let i = 0; i < pts.length; i++) {
      add(pts[i].u, pts[i].v, "vertex", 0);
      if (i > 0) {
        add((pts[i - 1].u + pts[i].u) / 2, (pts[i - 1].v + pts[i].v) / 2, "mid", 0);
      }
    }
    if (pl.closed && pts.length > 1) {
      add((pts[pts.length - 1].u + pts[0].u) / 2, (pts[pts.length - 1].v + pts[0].v) / 2, "mid", 0);
    }
    polylineCenters(pts, !!pl.closed).forEach((c) => add(c.u, c.v, "center", 2));
  });
  (slice.segments || []).forEach((seg) => {
    if (!seg || !seg.a || !seg.b) return;
    add(seg.a.u, seg.a.v, "vertex", 0);
    add(seg.b.u, seg.b.v, "vertex", 0);
    add((seg.a.u + seg.b.u) / 2, (seg.a.v + seg.b.v) / 2, "mid", 0);
  });
  // Истинные центры тел из mesh (sphere/cylinder/box) — обязательный snap.
  (previewMeshes || []).forEach((m) => {
    const uv = meshCenterToUv(m, slice);
    if (uv) add(uv.u, uv.v, "center", 3);
  });
  return out;
}

function snapUv(slot, uv, anchor) {
  if (!uv || !slot.cam) return { u: uv.u, v: uv.v, kind: null, ortho: null };
  const scale = slot.cam.fitScale * slot.view.zoom;
  if (!scale) return { u: uv.u, v: uv.v, kind: null, ortho: null };
  const thresh = SNAP_PX / scale;
  const centerThresh = SNAP_CENTER_PX / scale;
  let best = null;
  let bestScore = Infinity;
  collectSnapCandidates(slot).forEach((c) => {
    const d = Math.hypot(c.u - uv.u, c.v - uv.v);
    const isCenter = c.kind === "center";
    const limit = isCenter ? centerThresh : thresh;
    if (d > limit) return;
    // score: расстояние минус бонус за центр (центры обязательны и не проигрывают вершинам рядом)
    const score = d - (isCenter ? thresh * 0.35 : 0) - (c.priority || 0) * thresh * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  });
  // Если курсор внутри замкнутой фигуры — притягиваем к её центру (если в радиусе).
  if (!best || best.kind !== "center") {
    (slot.slice.polylines || []).forEach((pl) => {
      if (!pl || !pl.closed || !pl.points || pl.points.length < 3) return;
      if (!pointInPoly(uv, pl.points)) return;
      const centers = polylineCenters(pl.points, true);
      centers.forEach((c) => {
        const d = Math.hypot(c.u - uv.u, c.v - uv.v);
        if (d > centerThresh * 1.4) return;
        const score = d - thresh * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = { u: c.u, v: c.v, kind: "center", priority: 4 };
        }
      });
    });
  }
  let ortho = null;
  let bestD = best ? Math.hypot(best.u - uv.u, best.v - uv.v) : thresh;
  // Проекция на рёбра полилиний (прилипание к кривым/прямым контурам).
  ((slot.slice && slot.slice.polylines) || []).forEach((pl) => {
    const pts = pl && pl.points;
    if (!pts || pts.length < 2) return;
    const nSeg = pl.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < nSeg; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.u - a.u;
      const dy = b.v - a.v;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-24) continue;
      let t = ((uv.u - a.u) * dx + (uv.v - a.v) * dy) / len2;
      t = clamp(t, 0, 1);
      const pu = a.u + dx * t;
      const pv = a.v + dy * t;
      const d = Math.hypot(uv.u - pu, uv.v - pv);
      if (d > thresh) continue;
      const score = d - thresh * 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = { u: pu, v: pv, kind: "edge", priority: 1 };
        bestD = d;
      }
    }
  });
  if (anchor && Number.isFinite(anchor.u) && Number.isFinite(anchor.v)) {
    // Перпендикуляр: ножка от якоря на ребро (как OSNAP Perpendicular).
    ((slot.slice && slot.slice.polylines) || []).forEach((pl) => {
      const pts = pl && pl.points;
      if (!pts || pts.length < 2) return;
      const nSeg = pl.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < nSeg; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b.u - a.u;
        const dy = b.v - a.v;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-24) continue;
        let t = ((anchor.u - a.u) * dx + (anchor.v - a.v) * dy) / len2;
        t = clamp(t, 0, 1);
        const pu = a.u + dx * t;
        const pv = a.v + dy * t;
        const dFoot = Math.hypot(uv.u - pu, uv.v - pv);
        if (dFoot > thresh) continue;
        const score = dFoot - thresh * 0.12;
        if (score < bestScore) {
          bestScore = score;
          best = { u: pu, v: pv, kind: "perp" };
          bestD = dFoot;
        }
      }
    });
    const dH = Math.abs(uv.v - anchor.v);
    const dV = Math.abs(uv.u - anchor.u);
    if (dH <= thresh && dH <= bestD) {
      best = { u: uv.u, v: anchor.v, kind: "ortho-h" };
      bestD = dH;
      ortho = "h";
    }
    if (dV <= thresh && dV < bestD) {
      best = { u: anchor.u, v: uv.v, kind: "ortho-v" };
      bestD = dV;
      ortho = "v";
    }
    if (ortho && best && Math.abs(uv.u - anchor.u) <= thresh && Math.abs(uv.v - anchor.v) <= thresh) {
      best = { u: anchor.u, v: anchor.v, kind: "ortho-hv" };
      ortho = "hv";
    }
    if (best && best.kind !== "ortho-h" && best.kind !== "ortho-v" && best.kind !== "ortho-hv") {
      const nearH = Math.abs(best.v - anchor.v) <= thresh;
      const nearV = Math.abs(best.u - anchor.u) <= thresh;
      if (nearH && nearV) {
        ortho = "hv";
      } else if (nearH) {
        best = { u: best.u, v: anchor.v, kind: (best.kind || "snap") + "+h" };
        ortho = "h";
      } else if (nearV) {
        best = { u: anchor.u, v: best.v, kind: (best.kind || "snap") + "+v" };
        ortho = "v";
      }
    }
  }
  if (!best) return { u: uv.u, v: uv.v, kind: null, ortho: null };
  return { u: best.u, v: best.v, kind: best.kind, ortho: ortho };
}

function snapKindLabel(kind) {
  if (!kind) return "";
  if (kind === "ortho-hv") return "угол";
  if (kind === "ortho-h") return "горизонталь";
  if (kind === "ortho-v") return "вертикаль";
  const parts = [];
  if (/vertex/.test(kind)) parts.push("вершина");
  else if (/mid/.test(kind)) parts.push("середина");
  else if (/center/.test(kind)) parts.push("центр");
  else if (/edge/.test(kind)) parts.push("ребро");
  else if (/perp/.test(kind)) parts.push("перпендикуляр");
  if (/\+h/.test(kind)) parts.push("горизонталь");
  if (/\+v/.test(kind)) parts.push("вертикаль");
  return parts.join("+");
}

function fmtParamEdit(n) {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toFixed(6)).toString();
}

function readParamNums() {
  return currentFields.map((_, i) => {
    const el = document.getElementById("param_" + i);
    const raw = el ? String(el.value).trim() : "";
    if (!raw) return NaN;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    const up = raw.toUpperCase();
    const hit = (constants || []).find((c) => c && String(c.name).toUpperCase() === up);
    if (hit && Number.isFinite(hit.value)) return hit.value;
    return NaN;
  });
}

function writeParamsFromNums(nums, keepIndices) {
  const keep = keepIndices || new Set();
  nums.forEach((n, i) => {
    if (!Number.isFinite(n)) return;
    if (keep.has(i)) return;
    const el = document.getElementById("param_" + i);
    if (el) el.value = fmtParamEdit(n);
  });
}

function scheduleEditPreview() {
  if (editPreviewTimer) clearTimeout(editPreviewTimer);
  editPreviewTimer = setTimeout(() => {
    editPreviewTimer = 0;
    sendPreview();
  }, 40);
}

function flushEditPreview() {
  if (editPreviewTimer) {
    clearTimeout(editPreviewTimer);
    editPreviewTimer = 0;
  }
  sendPreview();
}

/** Мировые UV → пара координат сечения. */
function worldAxesForSlice(slice) {
  if (!slice) return { u: "x", v: "y" };
  if (slice.axis === "z") return { u: "x", v: "y" };
  if (slice.axis === "y") return { u: "x", v: "z" };
  return { u: "y", v: "z" };
}

function currentBodyTypeKey() {
  return (els.bodyType && els.bodyType.value ? els.bodyType.value : "").toUpperCase();
}

function isInteractiveBodyType(type) {
  return INTERACTIVE_PRIMS.some((p) => p.key === (type || "").toUpperCase());
}

/** Почему на холсте нет ручек правки (для подсказки в статусе). */
function editHandlesBlockReason() {
  if (liveMode) return "Правка недоступна в живом превью";
  const type = currentBodyTypeKey();
  if (!type) return "Правка: выберите тип тела или примитив на палитре";
  if (!isInteractiveBodyType(type)) {
    return "Правка: для " + type + " ручек нет — палитра SPH/RCZ/RCC/RPP/HEX*";
  }
  if (!currentFields.length) return "Правка: нет полей параметров — обновите превью";
  const p = readParamNums();
  if (!p.length || p.some((n) => !Number.isFinite(n))) {
    return "Правка: в параметрах нужны числа или известные EQU";
  }
  const slot = sliceSlots.find((s) => s && s.slice && s.slice.bounds);
  if (!slot) return "Правка: нет превью — дождитесь сечения или нажмите Обновить";
  if (!getDraftHandles(slot).length) return "Правка: не удалось построить ручки для " + type;
  return "";
}

function hitDraftBody(slot, uv) {
  if (!uv || !slot || !slot.slice || !slot.cam) return false;
  const scale = slot.cam.fitScale * slot.view.zoom;
  if (!scale) return false;
  const edgeThresh = 10 / scale;
  for (let i = 0; i < (slot.slice.polylines || []).length; i++) {
    const pl = slot.slice.polylines[i];
    if (!pl || !pl.highlight || !pl.points || pl.points.length < 2) continue;
    if (pl.closed && pointInPoly(uv, pl.points)) return true;
    const pts = pl.points;
    const nSeg = pl.closed ? pts.length : pts.length - 1;
    for (let s = 0; s < nSeg; s++) {
      if (distPointSeg(uv, pts[s], pts[(s + 1) % pts.length]) <= edgeThresh) return true;
    }
  }
  return false;
}

function beginHandleEdit(slot, handle) {
  if (!handle) return false;
  const center = getDraftHandles(slot).find((x) => x.kind === "center");
  editDrag = {
    slot: slot,
    id: handle.id,
    kind: handle.kind,
    anchorUv: center ? { u: center.u, v: center.v } : { u: handle.u, v: handle.v },
  };
  return true;
}

function getDraftHandles(slot) {
  if (liveMode || !slot || !slot.slice) return [];
  const type = currentBodyTypeKey();
  if (!isInteractiveBodyType(type)) return [];
  const p = readParamNums();
  const ax = worldAxesForSlice(slot.slice);
  const handles = [];
  const push = (id, u, v, kind) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    handles.push({ id: id, u: u, v: v, kind: kind });
  };

  if (type === "SPH" && p.length >= 4) {
    const cu = ax.u === "x" ? p[0] : ax.u === "y" ? p[1] : p[2];
    const cv = ax.v === "x" ? p[0] : ax.v === "y" ? p[1] : p[2];
    const R = Math.abs(p[3]);
    push("center", cu, cv, "center");
    push("radius", cu + R, cv, "radius");
  } else if ((type === "RCZ" || type === "RCC") && p.length >= 5) {
    // RCZ: x,y,z,H,R — на XY круг; RCC: x,y,z,dx,dy,dz,R
    let cu;
    let cv;
    let R;
    if (type === "RCZ") {
      cu = ax.u === "x" ? p[0] : ax.u === "y" ? p[1] : p[2];
      cv = ax.v === "x" ? p[0] : ax.v === "y" ? p[1] : p[2];
      R = Math.abs(p[4]);
    } else {
      cu = ax.u === "x" ? p[0] : ax.u === "y" ? p[1] : p[2];
      cv = ax.v === "x" ? p[0] : ax.v === "y" ? p[1] : p[2];
      R = Math.abs(p[6] ?? p[p.length - 1]);
    }
    push("center", cu, cv, "center");
    push("radius", cu + R, cv, "radius");
  } else if ((type === "HEXX" || type === "HEXY" || type === "HEX") && p.length >= 5) {
    const cu = ax.u === "x" ? p[0] : ax.u === "y" ? p[1] : p[2];
    const cv = ax.v === "x" ? p[0] : ax.v === "y" ? p[1] : p[2];
    let D;
    let rot = 0;
    if (type === "HEX") {
      D = Math.hypot(p[3], p[4]) || 1;
      rot = Math.atan2(p[4], p[3]);
    } else {
      D = Math.abs(p[4]);
      const fDeg = p[5] ?? 0;
      rot = ((fDeg + (type === "HEXY" ? 90 : 0)) * Math.PI) / 180;
    }
    const R = D / Math.sqrt(3);
    push("center", cu, cv, "center");
    push("size", cu + Math.cos(rot) * (D / 2), cv + Math.sin(rot) * (D / 2), "size");
    push("rotate", cu + Math.cos(rot + Math.PI / 2) * R * 1.15, cv + Math.sin(rot + Math.PI / 2) * R * 1.15, "rotate");
  } else if (type === "RPP" && p.length >= 6) {
    const u0 = ax.u === "x" ? p[0] : ax.u === "y" ? p[2] : p[4];
    const u1 = ax.u === "x" ? p[1] : ax.u === "y" ? p[3] : p[5];
    const v0 = ax.v === "x" ? p[0] : ax.v === "y" ? p[2] : p[4];
    const v1 = ax.v === "x" ? p[1] : ax.v === "y" ? p[3] : p[5];
    push("center", (u0 + u1) / 2, (v0 + v1) / 2, "center");
    push("c00", u0, v0, "corner");
    push("c10", u1, v0, "corner");
    push("c11", u1, v1, "corner");
    push("c01", u0, v1, "corner");
  }
  return handles;
}

function pickHandle(slot, uv) {
  if (!uv || !slot.cam) return null;
  const scale = slot.cam.fitScale * slot.view.zoom;
  if (!scale) return null;
  const thresh = 14 / scale;
  let best = null;
  let bestD = thresh;
  getDraftHandles(slot).forEach((h) => {
    const d = Math.hypot(h.u - uv.u, h.v - uv.v);
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  });
  return best;
}

function applyHandleToParams(slot, handle, uv) {
  const type = (els.bodyType && els.bodyType.value ? els.bodyType.value : "").toUpperCase();
  const p = readParamNums().slice();
  const ax = worldAxesForSlice(slot.slice);
  const setUV = (uIdx, vIdx, u, v) => {
    if (Number.isFinite(u) && uIdx >= 0) p[uIdx] = u;
    if (Number.isFinite(v) && vIdx >= 0) p[vIdx] = v;
  };
  const uIdx = ax.u === "x" ? 0 : ax.u === "y" ? 1 : 2;
  const vIdx = ax.v === "x" ? 0 : ax.v === "y" ? 1 : 2;

  if (handle.kind === "center") {
    if (type === "RPP" && p.length >= 6) {
      const u0 = ax.u === "x" ? p[0] : ax.u === "y" ? p[2] : p[4];
      const u1 = ax.u === "x" ? p[1] : ax.u === "y" ? p[3] : p[5];
      const v0 = ax.v === "x" ? p[0] : ax.v === "y" ? p[2] : p[4];
      const v1 = ax.v === "x" ? p[1] : ax.v === "y" ? p[3] : p[5];
      const du = uv.u - (u0 + u1) / 2;
      const dv = uv.v - (v0 + v1) / 2;
      const writePair = (lo, hi, d) => {
        p[lo] = (p[lo] ?? 0) + d;
        p[hi] = (p[hi] ?? 0) + d;
      };
      if (ax.u === "x") writePair(0, 1, du);
      else if (ax.u === "y") writePair(2, 3, du);
      else writePair(4, 5, du);
      if (ax.v === "x") writePair(0, 1, dv);
      else if (ax.v === "y") writePair(2, 3, dv);
      else writePair(4, 5, dv);
    } else {
      setUV(uIdx, vIdx, uv.u, uv.v);
    }
  } else if (handle.kind === "radius") {
    const cu = ax.u === "x" ? p[0] : ax.u === "y" ? p[1] : p[2];
    const cv = ax.v === "x" ? p[0] : ax.v === "y" ? p[1] : p[2];
    const R = Math.max(1e-6, Math.hypot(uv.u - cu, uv.v - cv));
    if (type === "SPH") p[3] = R;
    else if (type === "RCZ") p[4] = R;
    else if (type === "RCC") p[6] = R;
  } else if (handle.kind === "size" && (type === "HEXX" || type === "HEXY" || type === "HEX")) {
    const cu = p[0];
    const cv = p[1];
    // только на XY имеет смысл для HEX*
    if (slot.slice.axis === "z") {
      const dist = Math.hypot(uv.u - cu, uv.v - cv);
      const D = Math.max(1e-6, dist * 2);
      if (type === "HEX") {
        const ang = Math.atan2(p[4], p[3]) || 0;
        p[3] = D * Math.cos(ang);
        p[4] = D * Math.sin(ang);
      } else p[4] = D;
    }
  } else if (handle.kind === "rotate" && (type === "HEXX" || type === "HEXY" || type === "HEX")) {
    if (slot.slice.axis === "z") {
      const ang = (Math.atan2(uv.v - p[1], uv.u - p[0]) * 180) / Math.PI;
      if (type === "HEX") {
        const D = Math.hypot(p[3], p[4]) || 1;
        const rad = (ang * Math.PI) / 180;
        p[3] = D * Math.cos(rad);
        p[4] = D * Math.sin(rad);
      } else if (type === "HEXY") p[5] = ang - 90;
      else p[5] = ang;
    }
  } else if (handle.kind === "corner" && type === "RPP") {
    const mapU = ax.u === "x" ? [0, 1] : ax.u === "y" ? [2, 3] : [4, 5];
    const mapV = ax.v === "x" ? [0, 1] : ax.v === "y" ? [2, 3] : [4, 5];
    if (handle.id === "c00" || handle.id === "c01") p[mapU[0]] = uv.u;
    if (handle.id === "c10" || handle.id === "c11") p[mapU[1]] = uv.u;
    if (handle.id === "c00" || handle.id === "c10") p[mapV[0]] = uv.v;
    if (handle.id === "c01" || handle.id === "c11") p[mapV[1]] = uv.v;
    // нормализуем min<max
    if (p[mapU[0]] > p[mapU[1]]) {
      const t = p[mapU[0]];
      p[mapU[0]] = p[mapU[1]];
      p[mapU[1]] = t;
    }
    if (p[mapV[0]] > p[mapV[1]]) {
      const t = p[mapV[0]];
      p[mapV[0]] = p[mapV[1]];
      p[mapV[1]] = t;
    }
  }
  writeParamsFromNums(p);
  scheduleEditPreview();
}

function placeBodyAt(slot, uv) {
  const type = (placeBodyType || (els.bodyType && els.bodyType.value) || "").toUpperCase();
  if (!type || !els.bodyType) return;
  if (els.bodyType.value !== type) {
    els.bodyType.value = type;
    onTypeChange(false);
  }
  const t = types.find((x) => x.key === type);
  if (!t) return;
  const w = uvToWorld(slot.slice, uv);
  if (!w) return;
  const vals = t.fields.map((f) => f.defaultValue);
  // RPP: бокс 2×2×2 с центром в точке клика (все три оси, в т.ч. нормаль среза).
  if (type === "RPP") {
    const half = 1;
    vals[0] = fmtParamEdit(w.x - half);
    vals[1] = fmtParamEdit(w.x + half);
    vals[2] = fmtParamEdit(w.y - half);
    vals[3] = fmtParamEdit(w.y + half);
    vals[4] = fmtParamEdit(w.z - half);
    vals[5] = fmtParamEdit(w.z + half);
  } else {
    vals[0] = fmtParamEdit(w.x);
    vals[1] = fmtParamEdit(w.y);
    vals[2] = fmtParamEdit(w.z);
  }
  rebuildParams(t.fields, vals);
  placeBodyType = null;
  setToolMode("edit");
  renderPrimPalette();
  flushEditPreview();
}

let editHandlesPulseUntil = 0;

function drawEditHandles(ctx, slot, map) {
  if (toolMode !== "edit") return;
  const handles = getDraftHandles(slot);
  if (!handles.length) return;
  const pulse = editHandlesPulseUntil > performance.now();
  const center = handles.find((h) => h.kind === "center");
  if (center) {
    const c = map(center.u, center.v);
    handles.forEach((h) => {
      if (h.kind === "center") return;
      const q = map(h.u, h.v);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
  handles.forEach((h) => {
    const q = map(h.u, h.v);
    const r = pulse ? 8.5 : 6.5;
    ctx.beginPath();
    if (h.kind === "center") {
      if (pulse) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(230,25,75,0.45)";
        ctx.lineWidth = 2;
        ctx.arc(q.x, q.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.fillStyle = "rgba(230,25,75,0.95)";
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (h.kind === "rotate") {
      ctx.strokeStyle = "#89b4fa";
      ctx.fillStyle = "rgba(137,180,250,0.9)";
      ctx.lineWidth = 1.6;
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const s = pulse ? 13 : 11;
      ctx.fillStyle = h.kind === "corner" ? "#a6e3a1" : "#f9e2af";
      ctx.strokeStyle = "#11111b";
      ctx.lineWidth = 1.2;
      ctx.rect(q.x - s / 2, q.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
    }
  });
  if (pulse && center) {
    const c = map(center.u, center.v);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(205,214,244,0.95)";
    ctx.fillText("ручки: центр / размер / угол", c.x + 12, c.y - 12);
  }
}

function renderPrimPalette() {
  if (!els.primPalette || liveMode) return;
  els.primPalette.innerHTML = INTERACTIVE_PRIMS.map((p) => {
    const active = placeBodyType === p.key || (toolMode === "edit" && els.bodyType && els.bodyType.value === p.key && !placeBodyType);
    return (
      '<button type="button" class="bg-prim-btn' +
      (placeBodyType === p.key ? " is-active" : "") +
      '" data-prim="' +
      p.key +
      '" title="' +
      escapeAttr(p.title + " — клик, затем клик на сечении") +
      '">' +
      p.label +
      "</button>"
    );
  }).join("");
  els.primPalette.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-prim");
      if (!key) return;
      if (els.bodyType) {
        els.bodyType.value = key;
        onTypeChange(false);
      }
      placeBodyType = key;
      setToolMode("place");
      renderPrimPalette();
    });
  });
}

function updateCursorStatus(slot, uv, snap) {
  if (!els.cursorCoords) return;
  if (!slot || !uv || !slot.slice) {
    if (toolMode === "ruler") {
      els.cursorCoords.textContent = "Линейка: клик — точка · Esc — сброс · перетаскивание — сдвиг";
    } else if (toolMode === "exclude") {
      els.cursorCoords.textContent = "Исключить: клик по копии · исходник не исключается";
    } else if (toolMode === "place") {
      els.cursorCoords.textContent = "Размещение: клик на сечении · snap к фигурам";
    } else if (toolMode === "edit") {
      els.cursorCoords.textContent =
        editHandlesBlockReason() ||
        "Правка: красный центр / жёлтый размер / уголки · или тяните само тело · Esc — вид";
    } else {
      els.cursorCoords.textContent = "—";
    }
    return;
  }
  const pt = snap || uv;
  const w = uvToWorld(slot.slice, pt);
  if (!w) {
    els.cursorCoords.textContent = "—";
    return;
  }
  let text = "X=" + fmtCoord(w.x) + "  Y=" + fmtCoord(w.y) + "  Z=" + fmtCoord(w.z);
  const sk = snapKindLabel(snap && snap.kind);
  if (sk) text += "  ·  " + sk;
  const r = slot.ruler;
  if (r && r.p1) {
    const end = r.p2 || pt;
    const w1 = uvToWorld(slot.slice, r.p1);
    const w2 = uvToWorld(slot.slice, end);
    const d = worldDist(w1, w2);
    if (Number.isFinite(d)) {
      text += "  ·  L=" + fmtCoord(d);
      if (w1 && w2) {
        text +=
          "  (ΔX=" +
          fmtCoord(w2.x - w1.x) +
          " ΔY=" +
          fmtCoord(w2.y - w1.y) +
          " ΔZ=" +
          fmtCoord(w2.z - w1.z) +
          ")";
      }
    }
  }
  els.cursorCoords.textContent = text;
}

function placeTip(slot, clientX, clientY, text) {
  const wrap = slot.canvas && slot.canvas.parentElement;
  if (!slot.tip || !wrap || !text) {
    hideTip(slot);
    return;
  }
  const r = wrap.getBoundingClientRect();
  slot.tip.textContent = text;
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
  canvas.classList.toggle("is-panning", !!slot.drag && !editDrag);
  canvas.classList.toggle("is-hover", !slot.drag && !!slot.hoverName && toolMode === "pan");
  canvas.classList.toggle("is-ruler", toolMode === "ruler" && !slot.drag);
  canvas.classList.toggle("is-exclude", toolMode === "exclude" && !slot.drag);
  canvas.classList.toggle("is-edit", (toolMode === "edit" || toolMode === "place") && !slot.drag && !editDrag);
  canvas.classList.toggle("is-place", toolMode === "place" && !editDrag);
  canvas.classList.toggle("is-edit-handle", !!(editDrag && editDrag.slot === slot));
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

function readForm() {
  const params = currentFields.map((_, i) => {
    const input = document.getElementById("param_" + i);
    return input ? input.value.trim() : "";
  });
  return {
    bodyType: els.bodyType.value,
    name: sanitizeBodyName(els.name.value),
    params,
    pattern: readPattern(),
  };
}

function sendPreview() {
  vscode.postMessage({ type: "preview", form: readForm(), pattern: readPattern() });
}

const PATTERN_MODES = {
  array: [
    { id: "linear", label: "Линейный" },
    { id: "rect", label: "Прямоугольный" },
    { id: "hexRings", label: "Гексагональная решётка" },
  ],
  curve: [
    { id: "segment", label: "Отрезок" },
    { id: "ring", label: "Кольцо" },
    { id: "trianglePerimeter", label: "Периметр треугольника" },
    { id: "hexPerimeter", label: "Периметр шестиугольника" },
  ],
  mirror: [{ id: "mirror", label: "Зеркало" }],
};

const PATTERN_DEFAULTS = {
  count: 3,
  stepMode: "vector",
  sx: 2,
  sy: 0,
  sz: 0,
  length: 2,
  dirX: 1,
  dirY: 0,
  dirZ: 0,
  n1: 2,
  n2: 3,
  ux: 2,
  uy: 0,
  uz: 0,
  vx: 0,
  vy: 2,
  vz: 0,
  rings: 1,
  pitch: 2,
  x0: 0,
  y0: 0,
  z0: 0,
  x1: 6,
  y1: 0,
  z1: 0,
  cx: 0,
  cy: 0,
  f0: 0,
  phi: 0,
  size: 4,
  sizeMode: "flat",
  perimeterRef: "center",
  A: 0,
  B: 0,
  f: 90,
};

let patternValues = Object.assign({}, PATTERN_DEFAULTS);
let lastInsertOk = true;

function patternGroup() {
  const checked = document.querySelector('input[name="patternGroup"]:checked');
  return checked ? checked.value : "none";
}

function numField(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

function textField(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const t = String(el.value || "").trim();
  return t !== "" ? t : fallback;
}

function strField(id, fallback) {
  const el = document.getElementById(id);
  return el ? String(el.value) : fallback;
}

function collectModeValues() {
  const mode = els.patternMode ? els.patternMode.value : "linear";
  const v = patternValues;
  if (mode === "linear") {
    v.count = textField("pat_count", v.count);
    const step = document.querySelector('input[name="stepMode"]:checked');
    v.stepMode = step ? step.value : v.stepMode;
    v.sx = textField("pat_sx", v.sx);
    v.sy = textField("pat_sy", v.sy);
    v.sz = textField("pat_sz", v.sz);
    v.length = textField("pat_length", v.length);
    v.dirX = textField("pat_dirX", v.dirX);
    v.dirY = textField("pat_dirY", v.dirY);
    v.dirZ = textField("pat_dirZ", v.dirZ);
  } else if (mode === "rect") {
    v.n1 = textField("pat_n1", v.n1);
    v.n2 = textField("pat_n2", v.n2);
    v.ux = textField("pat_ux", v.ux);
    v.uy = textField("pat_uy", v.uy);
    v.uz = textField("pat_uz", v.uz);
    v.vx = textField("pat_vx", v.vx);
    v.vy = textField("pat_vy", v.vy);
    v.vz = textField("pat_vz", v.vz);
  } else if (mode === "hexRings") {
    v.rings = textField("pat_rings", v.rings);
    v.pitch = textField("pat_pitch", v.pitch);
  } else if (mode === "segment") {
    v.count = textField("pat_count", v.count);
    v.x1 = textField("pat_x1", v.x1);
    v.y1 = textField("pat_y1", v.y1);
    v.z1 = textField("pat_z1", v.z1);
  } else if (mode === "ring") {
    v.count = textField("pat_count", v.count);
    v.cx = textField("pat_cx", v.cx);
    v.cy = textField("pat_cy", v.cy);
    v.f0 = textField("pat_f0", v.f0);
  } else if (mode === "trianglePerimeter" || mode === "hexPerimeter") {
    v.count = textField("pat_count", v.count);
    const pref = document.querySelector('input[name="perimeterRef"]:checked');
    v.perimeterRef = pref ? pref.value : v.perimeterRef || "center";
    v.cx = textField("pat_cx", v.cx);
    v.cy = textField("pat_cy", v.cy);
    v.phi = textField("pat_phi", v.phi);
    v.size = textField("pat_size", v.size);
    const sm = document.querySelector('input[name="sizeMode"]:checked');
    v.sizeMode = sm ? sm.value : v.sizeMode;
  } else if (mode === "mirror") {
    v.A = textField("pat_A", v.A);
    v.B = textField("pat_B", v.B);
    v.f = textField("pat_f", v.f);
  }
}

function readPattern() {
  if (!els.patternFields) {
    return { group: "none", mode: "linear", values: Object.assign({}, PATTERN_DEFAULTS) };
  }
  collectModeValues();
  return {
    group: patternGroup(),
    mode: els.patternMode ? els.patternMode.value : "linear",
    values: Object.assign({}, patternValues),
    excludedIndices: excludedIndices.slice(),
  };
}

function vecRow(prefix, label, keys, hint) {
  const tip = hint ? ' class="has-hint" data-hint="' + escapeAttr(hint) + '"' : "";
  return (
    '<div class="bg-vec3"><span' +
    tip +
    ">" +
    label +
    '</span><input id="' +
    prefix +
    keys[0] +
    '" type="text" list="equList" spellcheck="false" autocomplete="off" /><input id="' +
    prefix +
    keys[1] +
    '" type="text" list="equList" spellcheck="false" autocomplete="off" /><input id="' +
    prefix +
    keys[2] +
    '" type="text" list="equList" spellcheck="false" autocomplete="off" /></div>'
  );
}

function nRow(id, label, hint, extra) {
  const tip = hint ? ' class="has-hint" data-hint="' + escapeAttr(hint) + '"' : "";
  return (
    '<div class="bg-param-row"><label for="' +
    id +
    '"' +
    tip +
    ">" +
    label +
    '</label><input id="' +
    id +
    '" type="text" list="equList" spellcheck="false" autocomplete="off" ' +
    (extra || "") +
    " /></div>"
  );
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

const PATTERN_FIELD_HINTS = {
  pat_count: "Число тел, включая исходник (≥2). Можно EQU.",
  pat_n1: "Число по первому вектору шага. Можно EQU.",
  pat_n2: "Число по второму вектору шага. Можно EQU.",
  pat_sx: "Вектор шага: ΔX между соседними телами.",
  pat_sy: "Вектор шага: ΔY.",
  pat_sz: "Вектор шага: ΔZ.",
  pat_length: "Длина шага L. Можно EQU.",
  pat_dirX: "Направление шага (X), нормализуется.",
  pat_dirY: "Направление шага (Y).",
  pat_dirZ: "Направление шага (Z).",
  pat_ux: "Вектор u сетки: шаг по столбцам (X).",
  pat_uy: "Вектор u: шаг по столбцам (Y).",
  pat_uz: "Вектор u: шаг по столбцам (Z).",
  pat_vx: "Вектор v сетки: шаг по строкам (X).",
  pat_vy: "Вектор v: шаг по строкам (Y).",
  pat_vz: "Вектор v: шаг по строкам (Z).",
  pat_rings: "Радиус решётки R (шагов от центра). R=1 → 7 тел, R=6 → 127 (как ТВС). N = 1 + 3·R·(R+1).",
  pat_pitch: "Шаг решётки — расстояние между центрами соседних тел. Можно EQU.",
  pat_x1: "Конец отрезка, X (сцена). Начало — центр исходника.",
  pat_y1: "Конец отрезка, Y.",
  pat_z1: "Конец отрезка, Z.",
  pat_cx: "Центр (X). Для кольца — ось TRANSF R. Можно EQU.",
  pat_cy: "Центр (Y). Можно EQU.",
  pat_f0: "Поворот всего кольца, °. Исходник тоже сдвигается на f0; шаг между телами = 360°/N.",
  pat_phi: "Поворот фигуры периметра, °.",
  pat_size: "Размер фигуры (под ключ или сторона). Можно EQU.",
  pat_A: "Точка плоскости зеркала, A (как TRANSF M).",
  pat_B: "Точка плоскости зеркала, B.",
  pat_f: "Угол плоскости к OX, ° (как TRANSF M).",
};

function modeHint(mode) {
  if (mode === "segment") return "Начало = центр исходника. Задайте только конец P1 (число или EQU).";
  if (mode === "ring") return "Шаг = 360°/N. f0 поворачивает всё кольцо (включая исходник) вокруг (cx,cy), как TRANSF R.";
  if (mode === "hexRings") {
    return "Гексагональная упаковка flat-top (как HEXX f=0): исходник в центре, соседи по ±X на расстоянии «шаг». N = 1 + 3·R·(R+1).";
  }
  if (mode === "trianglePerimeter" || mode === "hexPerimeter") {
    return "Точки равномерно по длине периметра. Для вершин: n = k·сторон. Выберите привязку: центр фигуры или исходник на контуре.";
  }
  if (mode === "mirror") return "Отражение от вертикальной плоскости через (A,B), угол f° к OX (как TRANSF M).";
  if (mode === "linear") return "Ряд от исходника с постоянным шагом (вектор или длина+направление).";
  if (mode === "rect") return "Сетка N1×N2; исходник в углу (0,0).";
  return "";
}

function renderModeFields() {
  if (!els.patternModeFields || !els.patternMode) return;
  const mode = els.patternMode.value;
  let html = "";
  if (mode === "linear") {
    html =
      nRow("pat_count", "N", PATTERN_FIELD_HINTS.pat_count) +
      '<div class="bg-pattern-radios">' +
      '<label data-hint="Шаг задаётся вектором (sx,sy,sz)"><input type="radio" name="stepMode" value="vector" /> вектор шага</label>' +
      '<label data-hint="Шаг = длина L вдоль направления (нормализуется)"><input type="radio" name="stepMode" value="lengthDir" /> длина + направление</label>' +
      "</div>" +
      vecRow("pat_", "шаг", ["sx", "sy", "sz"], "Вектор шага между соседними телами (можно EQU)") +
      nRow("pat_length", "L", PATTERN_FIELD_HINTS.pat_length) +
      vecRow("pat_", "dir", ["dirX", "dirY", "dirZ"], "Направление шага (не обязательно единичное)");
  } else if (mode === "rect") {
    html =
      nRow("pat_n1", "N1", PATTERN_FIELD_HINTS.pat_n1) +
      nRow("pat_n2", "N2", PATTERN_FIELD_HINTS.pat_n2) +
      vecRow("pat_", "u", ["ux", "uy", "uz"], "Шаг по столбцам") +
      vecRow("pat_", "v", ["vx", "vy", "vz"], "Шаг по строкам");
  } else if (mode === "hexRings") {
    html =
      nRow("pat_rings", "радиус R", PATTERN_FIELD_HINTS.pat_rings) +
      nRow("pat_pitch", "шаг", PATTERN_FIELD_HINTS.pat_pitch) +
      '<p class="bg-hint" id="pat_hex_count">N = —</p>';
  } else if (mode === "segment") {
    html =
      nRow("pat_count", "N", PATTERN_FIELD_HINTS.pat_count) +
      '<p class="bg-hint" id="pat_segment_start">Начало (P0) = центр исходника</p>' +
      vecRow("pat_", "конец P1", ["x1", "y1", "z1"], "Конец отрезка в координатах сцены. Начало — центр первого тела.");
  } else if (mode === "ring") {
    html =
      nRow("pat_count", "N", PATTERN_FIELD_HINTS.pat_count) +
      nRow("pat_cx", "cx", PATTERN_FIELD_HINTS.pat_cx) +
      nRow("pat_cy", "cy", PATTERN_FIELD_HINTS.pat_cy) +
      nRow("pat_f0", "f0°", PATTERN_FIELD_HINTS.pat_f0) +
      '<p class="bg-hint" id="pat_radius">R ≈ —</p>';
  } else if (mode === "trianglePerimeter" || mode === "hexPerimeter") {
    html =
      nRow("pat_count", "N", PATTERN_FIELD_HINTS.pat_count) +
      '<div class="bg-pattern-radios">' +
      '<label data-hint="cx,cy — центр фигуры; исходник переносится на контур, копии по периметру">' +
      '<input type="radio" name="perimeterRef" value="center" /> центр (cx, cy)</label>' +
      '<label data-hint="Образующая проходит через центр исходника; cx/cy не нужны">' +
      '<input type="radio" name="perimeterRef" value="seed" /> исходник на контуре</label>' +
      "</div>" +
      nRow("pat_cx", "cx", PATTERN_FIELD_HINTS.pat_cx) +
      nRow("pat_cy", "cy", PATTERN_FIELD_HINTS.pat_cy) +
      nRow("pat_phi", "φ°", PATTERN_FIELD_HINTS.pat_phi) +
      nRow("pat_size", "размер", PATTERN_FIELD_HINTS.pat_size) +
      '<div class="bg-pattern-radios">' +
      '<label data-hint="Размер «под ключ» (flat-to-flat)"><input type="radio" name="sizeMode" value="flat" /> под ключ</label>' +
      '<label data-hint="Длина стороны многоугольника"><input type="radio" name="sizeMode" value="side" /> сторона</label>' +
      "</div>";
  } else if (mode === "mirror") {
    html =
      nRow("pat_A", "A", PATTERN_FIELD_HINTS.pat_A) +
      nRow("pat_B", "B", PATTERN_FIELD_HINTS.pat_B) +
      nRow("pat_f", "f°", PATTERN_FIELD_HINTS.pat_f);
  }
  els.patternModeFields.innerHTML = html;
  fillModeInputs();
  if (els.patternModeHint) els.patternModeHint.textContent = modeHint(mode);
  bindPatternFieldEvents();
  bindPatternHints();
}

function hexLatticeInstanceCount(rings) {
  const r = Math.round(Number(rings));
  if (!Number.isFinite(r) || r < 0) return null;
  return 1 + 3 * r * (r + 1);
}

function syncHexLatticeCount() {
  const el = document.getElementById("pat_hex_count");
  if (!el) return;
  const mode = els.patternMode ? els.patternMode.value : "";
  if (mode !== "hexRings") return;
  const rRaw = textField("pat_rings", patternValues.rings);
  const n = hexLatticeInstanceCount(rRaw);
  if (n === null) {
    el.textContent = "N = —";
  } else {
    const r = Math.round(Number(rRaw));
    el.textContent = `N = ${n} позиций · сторона ≈ ${r + 1}`;
  }
}

function fillModeInputs() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = String(val);
  };
  const v = patternValues;
  set("pat_count", v.count);
  set("pat_sx", v.sx);
  set("pat_sy", v.sy);
  set("pat_sz", v.sz);
  set("pat_length", v.length);
  set("pat_dirX", v.dirX);
  set("pat_dirY", v.dirY);
  set("pat_dirZ", v.dirZ);
  set("pat_n1", v.n1);
  set("pat_n2", v.n2);
  set("pat_ux", v.ux);
  set("pat_uy", v.uy);
  set("pat_uz", v.uz);
  set("pat_vx", v.vx);
  set("pat_vy", v.vy);
  set("pat_vz", v.vz);
  set("pat_rings", v.rings);
  set("pat_pitch", v.pitch);
  set("pat_x1", v.x1);
  set("pat_y1", v.y1);
  set("pat_z1", v.z1);
  set("pat_cx", v.cx);
  set("pat_cy", v.cy);
  set("pat_f0", v.f0);
  set("pat_phi", v.phi);
  set("pat_size", v.size);
  set("pat_A", v.A);
  set("pat_B", v.B);
  set("pat_f", v.f);
  document.querySelectorAll('input[name="stepMode"]').forEach((el) => {
    el.checked = el.value === v.stepMode;
  });
  document.querySelectorAll('input[name="sizeMode"]').forEach((el) => {
    el.checked = el.value === v.sizeMode;
  });
  document.querySelectorAll('input[name="perimeterRef"]').forEach((el) => {
    el.checked = el.value === (v.perimeterRef || "center");
  });
  syncLinearStepVisibility();
  syncPerimeterRefVisibility();
  syncHexLatticeCount();
}

function syncLinearStepVisibility() {
  const step = document.querySelector('input[name="stepMode"]:checked');
  const byVec = !step || step.value === "vector";
  const len = document.getElementById("pat_length");
  const sx = document.getElementById("pat_sx");
  if (sx && sx.parentElement) sx.parentElement.hidden = !byVec;
  if (len) {
    len.parentElement.hidden = byVec;
    const dir = document.getElementById("pat_dirX");
    if (dir && dir.parentElement) dir.parentElement.hidden = byVec;
  }
}

function syncPerimeterRefVisibility() {
  const pref = document.querySelector('input[name="perimeterRef"]:checked');
  const onSeed = pref && pref.value === "seed";
  const cx = document.getElementById("pat_cx");
  const cy = document.getElementById("pat_cy");
  if (cx && cx.parentElement) cx.parentElement.hidden = !!onSeed;
  if (cy && cy.parentElement) cy.parentElement.hidden = !!onSeed;
}

function bindPatternFieldEvents() {
  if (!els.patternModeFields) return;
  els.patternModeFields.querySelectorAll("input").forEach((el) => {
    el.addEventListener("change", () => {
      collectModeValues();
      syncLinearStepVisibility();
      syncPerimeterRefVisibility();
      syncHexLatticeCount();
      sendPreview();
    });
    el.addEventListener("input", () => {
      collectModeValues();
      syncLinearStepVisibility();
      syncPerimeterRefVisibility();
      syncHexLatticeCount();
      sendPreview();
    });
  });
}

function fillModeSelect(group) {
  if (!els.patternMode) return;
  const list = PATTERN_MODES[group] || [];
  const prev = els.patternMode.value;
  els.patternMode.innerHTML = list
    .map((m) => '<option value="' + m.id + '">' + m.label + "</option>")
    .join("");
  if (list.some((m) => m.id === prev)) els.patternMode.value = prev;
  else if (list[0]) els.patternMode.value = list[0].id;
}

function bindPatternHints() {
  const bind = (el, text) => {
    if (!el || !text) return;
    bindParamHint(el, text);
    if (el.tagName === "INPUT" || el.tagName === "SELECT") el.title = text;
  };
  Object.keys(PATTERN_FIELD_HINTS).forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      bind(input, PATTERN_FIELD_HINTS[id]);
      const lab = input.closest(".bg-param-row") && input.closest(".bg-param-row").querySelector("label");
      if (lab) bind(lab, PATTERN_FIELD_HINTS[id]);
    }
  });
  if (els.patternModeFields) {
    els.patternModeFields.querySelectorAll("[data-hint]").forEach((el) => {
      bind(el, el.getAttribute("data-hint"));
    });
    els.patternModeFields.querySelectorAll(".bg-vec3 input").forEach((input) => {
      const span = input.parentElement && input.parentElement.querySelector("span");
      const hint = (span && span.getAttribute("data-hint")) || PATTERN_FIELD_HINTS[input.id];
      bind(input, hint);
    });
  }
  const startHint = document.getElementById("pat_segment_start");
  if (startHint) bind(startHint, "Первое тело остаётся на месте — это начало отрезка.");
}

function renderPresets(group) {
  if (!els.patternPresets) return;
  const mode = els.patternMode ? els.patternMode.value : "";
  const presets = [];
  if (group === "array") {
    presets.push(
      { title: "Ряд×3", group: "array", mode: "linear", values: { count: 3, stepMode: "vector", sx: 2, sy: 0, sz: 0 } },
      { title: "Сетка 2×3", group: "array", mode: "rect", values: { n1: 2, n2: 3, ux: 2, uy: 0, uz: 0, vx: 0, vy: 2, vz: 0 } },
      { title: "Гекс×7", hint: "Решётка R=1: 7 тел", group: "array", mode: "hexRings", values: { rings: 1, pitch: 2 } },
      { title: "Гекс×19", hint: "Решётка R=2: 19 тел", group: "array", mode: "hexRings", values: { rings: 2, pitch: 2 } },
      { title: "Гекс×127", hint: "Решётка R=6: 127 тел (как ТВС)", group: "array", mode: "hexRings", values: { rings: 6, pitch: 2 } }
    );
  }
  if (group === "curve") {
    if (!mode || mode === "segment") {
      presets.push({ title: "Отрезок×4", group: "curve", mode: "segment", values: { count: 4, x1: 12.5, y1: 0, z1: 0 } });
    }
    if (!mode || mode === "ring") {
      presets.push({ title: "Кольцо×6", group: "curve", mode: "ring", values: { count: 6, cx: 0, cy: 0, f0: 0 } });
    }
  }
  if (group === "mirror") {
    presets.push({ title: "Зеркало OX", group: "mirror", mode: "mirror", values: { A: 0, B: 0, f: 0 } });
  }
  els.patternPresets.innerHTML = presets
    .map((p, i) => '<button type="button" class="bg-preset" data-preset="' + i + '" title="' + escapeAttr(p.hint || "Заполнить поля пресетом") + '">' + p.title + "</button>")
    .join("");
  els.patternPresets.querySelectorAll("button").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const p = presets[i];
      Object.assign(patternValues, p.values);
      excludedIndices = [];
      syncPatternExcludeUi();
      if (els.patternMode) els.patternMode.value = p.mode;
      renderPresets(group);
      renderModeFields();
      sendPreview();
    });
  });
}

function applyPatternGroupUi() {
  const group = patternGroup();
  if (els.patternFields) els.patternFields.hidden = group === "none";
  syncPatternExcludeUi();
  if (group === "none") return;
  fillModeSelect(group);
  renderModeFields();
  renderPresets(group);
}

function applyPatternFromState(pattern) {
  if (!pattern || !els.patternFields) return;
  Object.assign(patternValues, pattern.values || {});
  excludedIndices = Array.isArray(pattern.excludedIndices) ? pattern.excludedIndices.slice() : [];
  document.querySelectorAll('input[name="patternGroup"]').forEach((el) => {
    el.checked = el.value === (pattern.group || "none");
  });
  applyPatternGroupUi();
  if (els.patternMode && pattern.mode) els.patternMode.value = pattern.mode;
  renderModeFields();
}

function applyPatternStatus(status) {
  if (!status) return;
  if (els.patternStatus) {
    const extra = [status.hint, status.radiusText].filter(Boolean).join(" · ");
    els.patternStatus.textContent = extra ? status.summary + " · " + extra : status.summary;
  }
  const radiusEl = document.getElementById("pat_radius");
  if (radiusEl) radiusEl.textContent = status.radiusText || "R ≈ —";
  lastInsertOk = status.okToInsert !== false;
  if (els.btnInsert) els.btnInsert.disabled = !lastInsertOk;
  syncPatternExcludeUi();
}

function initPatternUi() {
  if (liveMode || !els.patternFields) return;
  const groupHints = {
    none: "Одна строка BODY, без копий",
    array: "Линейный, прямоугольный или гексагональная решётка (упаковка как на ТВС)",
    curve: "Отрезок, кольцо или периметр",
    mirror: "Зеркальная копия (TRANSF M, если можно)",
  };
  document.querySelectorAll('input[name="patternGroup"]').forEach((el) => {
    const lab = el.closest("label");
    const tip = groupHints[el.value];
    if (lab && tip) {
      lab.title = tip;
      bindParamHint(lab, tip);
    }
    el.addEventListener("change", () => {
      applyPatternGroupUi();
      sendPreview();
    });
  });
  if (els.patternMode) {
    els.patternMode.title = "Режим размножения внутри выбранной группы";
    bindParamHint(els.patternMode, els.patternMode.title);
    els.patternMode.addEventListener("change", () => {
      excludedIndices = [];
      syncPatternExcludeUi();
      renderModeFields();
      renderPresets(patternGroup());
      sendPreview();
    });
  }
  if (els.btnResetExclusions) {
    els.btnResetExclusions.addEventListener("click", () => resetExclusions());
  }
  applyPatternGroupUi();
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
  return out.toUpperCase();
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
  renderPrimPalette();
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

function drawMeasureOverlay(ctx, slot, map, cssW, cssH) {
  if (!slot || !ctx) return;
  const snap = slot.snap;
  const ruler = slot.ruler;
  const b = slot.slice && slot.slice.bounds;

  if (ruler && ruler.p1 && b) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(137, 180, 250, 0.55)";
    // H/V guides through first point
    const g0 = map(ruler.p1.u, b.vMin);
    const g1 = map(ruler.p1.u, b.vMax);
    ctx.beginPath();
    ctx.moveTo(g0.x, 0);
    ctx.lineTo(g1.x, cssH);
    ctx.stroke();
    const h0 = map(b.uMin, ruler.p1.v);
    ctx.beginPath();
    ctx.moveTo(0, h0.y);
    ctx.lineTo(cssW, h0.y);
    ctx.stroke();
    ctx.restore();
  }

  if (snap && snap.ortho && ruler && ruler.p1) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(249, 226, 175, 0.9)";
    if (snap.ortho === "h" || snap.ortho === "hv") {
      const y = map(ruler.p1.u, ruler.p1.v).y;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }
    if (snap.ortho === "v" || snap.ortho === "hv") {
      const x = map(ruler.p1.u, ruler.p1.v).x;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    }
    ctx.restore();
  }

  function mark(pt, color, r) {
    if (!pt) return;
    const q = map(pt.u, pt.v);
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#11111b";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (snap && Number.isFinite(snap.u)) {
    const q = map(snap.u, snap.v);
    ctx.save();
    const isCenter = snap.kind && String(snap.kind).indexOf("center") >= 0;
    ctx.strokeStyle = isCenter ? "#a6e3a1" : "#f9e2af";
    ctx.lineWidth = isCenter ? 1.7 : 1.4;
    if (isCenter) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(q.x - 8, q.y);
    ctx.lineTo(q.x + 8, q.y);
    ctx.moveTo(q.x, q.y - 8);
    ctx.lineTo(q.x, q.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  if (ruler && ruler.p1) {
    const end = ruler.p2 || (snap ? { u: snap.u, v: snap.v } : slot.cursorUv);
    mark(ruler.p1, "#89b4fa", 4);
    if (end) {
      const a = map(ruler.p1.u, ruler.p1.v);
      const b2 = map(end.u, end.v);
      ctx.save();
      ctx.strokeStyle = "#89b4fa";
      ctx.lineWidth = 1.6;
      ctx.setLineDash(ruler.p2 ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      mark(end, ruler.p2 ? "#a6e3a1" : "#f9e2af", 4);
      const w1 = uvToWorld(slot.slice, ruler.p1);
      const w2 = uvToWorld(slot.slice, end);
      const d = worldDist(w1, w2);
      if (Number.isFinite(d)) {
        const mx = (a.x + b2.x) / 2;
        const my = (a.y + b2.y) / 2;
        const label = "L=" + fmtCoord(d);
        ctx.font = "11px Consolas, monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(17,17,27,0.82)";
        ctx.fillRect(mx - tw / 2 - 4, my - 16, tw + 8, 16);
        ctx.fillStyle = "#cdd6f4";
        ctx.fillText(label, mx - tw / 2, my - 4);
      }
      ctx.restore();
    }
  }
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
  const pad = 22;
  const innerW = cssW - 2 * pad;
  const innerH = cssH - 2 * pad;
  const freeze = viewFitFrozen();
  let fitScale;
  let ox;
  let oy;
  let uMin;
  let vMin;
  // Span мира по срезу — нужен и для fit-камеры, и для ячеек slice.grid.
  const du = b.uMax - b.uMin || 1;
  const dv = b.vMax - b.vMin || 1;
  if (freeze && slot.camLock && Number.isFinite(slot.camLock.fitScale)) {
    // Замороженный вид: масштаб мира не следует за bbox при правке.
    const lb = slot.camLock.bounds;
    const duL = (lb.uMax - lb.uMin) || 1;
    const dvL = (lb.vMax - lb.vMin) || 1;
    fitScale = slot.camLock.fitScale;
    uMin = slot.camLock.uMin;
    vMin = slot.camLock.vMin;
    ox = pad + (innerW - duL * fitScale) / 2;
    oy = pad + (innerH - dvL * fitScale) / 2;
  } else {
    fitScale = Math.min(innerW / du, innerH / dv);
    uMin = b.uMin;
    vMin = b.vMin;
    ox = pad + (innerW - du * fitScale) / 2;
    oy = pad + (innerH - dv * fitScale) / 2;
    if (freeze) {
      slot.camLock = {
        fitScale: fitScale,
        uMin: b.uMin,
        vMin: b.vMin,
        bounds: { uMin: b.uMin, uMax: b.uMax, vMin: b.vMin, vMax: b.vMax },
      };
    } else {
      slot.camLock = null;
    }
  }
  const scale = fitScale * view.zoom;
  slot.cam = { uMin: uMin, vMin: vMin, fitScale: fitScale, ox: ox, oy: oy, cssW: cssW, cssH: cssH };

  function map(u, v) {
    return {
      x: ox + view.panX + (u - uMin) * scale,
      y: cssH - oy - view.panY - (v - vMin) * scale,
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

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();

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
    const zoneName = slice.zoneIndex && slice.zoneIndex[1] && slice.zoneIndex[1].name;
    const zoneColor = slice.zoneIndex && slice.zoneIndex[1] && slice.zoneIndex[1].color ? slice.zoneIndex[1].color : "#3d9a8b";
    const isZonePoly = (pl) => pl && pl.closed && (zoneName ? pl.name === zoneName : !!pl.highlight);
    ctx.beginPath();
    // Заливка/штриховка только самой зоны. Соседи — только контур, иначе AABB соседей
    // даёт «квадрат в мелкую сетку» на весь кадр.
    (slice.polylines || [])
      .filter(isZonePoly)
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
    ctx.beginPath();
    (slice.polylines || [])
      .filter(isZonePoly)
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
    drawMeasureOverlay(ctx, slot, map, cssW, cssH);
    ctx.fillStyle = "#9d9d9d";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(slice.uLabel || "U", cssW - 18, cssH - 6);
    ctx.fillText(slice.vLabel || "V", 6, 14);
    return;
  }
  if (slice.grid) {
    const rows = slice.grid.length || 0;
    const cols = rows ? slice.grid[0].length : 0;
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
    drawMeasureOverlay(ctx, slot, map, cssW, cssH);
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
      ctx.fillStyle = "rgba(230,25,75,0.22)";
      ctx.fill();
      ctx.strokeStyle = pl.color || "#e6194b";
      ctx.lineWidth = 2;
    } else {
      const inst = arrayInstances.find((x) => x.name === pl.name);
      const isExcluded = !!(inst && inst.excluded);
      if (isExcluded) {
        if (pl.closed) {
          ctx.fillStyle = "rgba(138,106,114,0.1)";
          ctx.fill();
        }
        ctx.strokeStyle = pl.color || "#8a6a72";
        ctx.lineWidth = 1.15;
        ctx.globalAlpha = 0.42;
        ctx.setLineDash([5, 4]);
      } else if (hovered) {
        ctx.fillStyle = "rgba(166,173,200,0.14)";
        if (pl.closed) ctx.fill();
        ctx.strokeStyle = "#cdd6f4";
        ctx.lineWidth = 2.15;
      } else {
        ctx.strokeStyle = pl.color || "#9aa0b8";
        ctx.lineWidth = 1.35;
        ctx.globalAlpha = 1;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });
  drawSlicePlaneMarkers();
  ctx.restore();

  drawMeasureOverlay(ctx, slot, map, cssW, cssH);
  drawEditHandles(ctx, slot, map);
  if (slot.snap && (toolMode === "edit" || toolMode === "place" || toolMode === "ruler") && !slot.drag) {
    const s = map(slot.snap.u, slot.snap.v);
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 236, 0, 0.95)";
    ctx.lineWidth = 1.4;
    ctx.moveTo(s.x - 7, s.y);
    ctx.lineTo(s.x + 7, s.y);
    ctx.moveTo(s.x, s.y - 7);
    ctx.lineTo(s.x, s.y + 7);
    ctx.stroke();
  }
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
    const loc = canvasLocal(canvas, e.clientX, e.clientY);
    const uv = screenToUv(slot, loc.x, loc.y);

    // Клик по уже нарисованному черновику → сразу Правка (даже из «Перемещение»).
    if (toolMode === "pan" && uv && hitDraftBody(slot, uv) && isInteractiveBodyType(currentBodyTypeKey())) {
      setToolMode("edit");
      const center = getDraftHandles(slot).find((x) => x.kind === "center");
      if (center && beginHandleEdit(slot, center)) {
        slot.drag = { x: e.clientX, y: e.clientY, moved: false, edit: true };
        setCanvasCursor(slot);
        return;
      }
    }

    if ((toolMode === "edit" || toolMode === "place") && uv) {
      if (toolMode === "edit") {
        const h = pickHandle(slot, uv);
        if (h && beginHandleEdit(slot, h)) {
          slot.drag = { x: e.clientX, y: e.clientY, moved: false, edit: true };
          setCanvasCursor(slot);
          return;
        }
        const center = getDraftHandles(slot).find((x) => x.kind === "center");
        if (center && hitDraftBody(slot, uv) && beginHandleEdit(slot, center)) {
          slot.drag = { x: e.clientX, y: e.clientY, moved: false, edit: true };
          setCanvasCursor(slot);
          return;
        }
      }
      if (toolMode === "place") {
        slot.drag = { x: e.clientX, y: e.clientY, moved: false, place: true };
        setCanvasCursor(slot);
        return;
      }
    }

    slot.drag = { x: e.clientX, y: e.clientY, moved: false };
    if (toolMode === "pan") {
      slot.hoverName = null;
      hideTip(slot);
    }
    setCanvasCursor(slot);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (slot.drag && slot.drag.edit && editDrag) {
      const loc = canvasLocal(canvas, e.clientX, e.clientY);
      const uv = screenToUv(slot, loc.x, loc.y);
      if (!uv) return;
      slot.drag.moved = true;
      const snap = snapUv(slot, uv, editDrag.kind === "center" ? null : editDrag.anchorUv);
      slot.snap = snap;
      applyHandleToParams(slot, editDrag, snap);
      updateCursorStatus(slot, uv, snap);
      requestSliceDraw();
      return;
    }
    if (slot.drag && !slot.drag.edit && !slot.drag.place) {
      const dx = e.clientX - slot.drag.x;
      const dy = e.clientY - slot.drag.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) slot.drag.moved = true;
      if (slot.drag.moved && (toolMode === "pan" || toolMode === "ruler" || toolMode === "exclude" || toolMode === "edit")) {
        // в edit без ручки — пан вид
        slot.drag.x = e.clientX;
        slot.drag.y = e.clientY;
        slot.view.panX += dx;
        slot.view.panY -= dy;
        requestSliceDraw();
      }
      return;
    }
    if (slot.drag && slot.drag.place) {
      const dx = e.clientX - slot.drag.x;
      const dy = e.clientY - slot.drag.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) slot.drag.moved = true;
      const loc = canvasLocal(canvas, e.clientX, e.clientY);
      const uv = screenToUv(slot, loc.x, loc.y);
      const snap = uv ? snapUv(slot, uv, null) : null;
      slot.snap = snap;
      updateCursorStatus(slot, uv, snap);
      requestSliceDraw();
      return;
    }
    const loc = canvasLocal(canvas, e.clientX, e.clientY);
    const uv = screenToUv(slot, loc.x, loc.y);
    slot.cursorUv = uv;

    if (toolMode === "ruler") {
      const anchor = slot.ruler && slot.ruler.p1 && !slot.ruler.p2 ? slot.ruler.p1 : null;
      const snap = uv ? snapUv(slot, uv, anchor) : null;
      slot.snap = snap;
      updateCursorStatus(slot, uv, snap);
      slot.hoverName = null;
      const tipParts = [];
      if (snap && snap.kind) tipParts.push(snapKindLabel(snap.kind));
      if (slot.ruler && slot.ruler.p1 && snap) {
        const w1 = uvToWorld(slot.slice, slot.ruler.p1);
        const w2 = uvToWorld(slot.slice, snap);
        const d = worldDist(w1, w2);
        if (Number.isFinite(d)) tipParts.push("L=" + fmtCoord(d));
      }
      if (tipParts.length) placeTip(slot, e.clientX, e.clientY, tipParts.join(" · "));
      else hideTip(slot);
      drawOneSlice(slot, slot.slice);
      setCanvasCursor(slot);
      return;
    }

    if (toolMode === "place" || toolMode === "edit") {
      const snap = uv ? snapUv(slot, uv, null) : null;
      slot.snap = snap;
      updateCursorStatus(slot, uv, snap);
      const h = toolMode === "edit" && uv ? pickHandle(slot, uv) : null;
      const onBody = toolMode === "edit" && !h && uv ? hitDraftBody(slot, uv) : false;
      slot.hoverName = null;
      if (h) {
        placeTip(
          slot,
          e.clientX,
          e.clientY,
          h.kind === "center"
            ? "центр — перетащить"
            : h.kind === "rotate"
              ? "поворот"
              : h.kind === "radius" || h.kind === "size"
                ? "размер"
                : "угол — растянуть"
        );
      } else if (onBody) placeTip(slot, e.clientX, e.clientY, "тело — перетащить");
      else if (toolMode === "place") placeTip(slot, e.clientX, e.clientY, "поставить " + (placeBodyType || ""));
      else {
        const why = editHandlesBlockReason();
        if (why) placeTip(slot, e.clientX, e.clientY, why);
        else hideTip(slot);
      }
      drawOneSlice(slot, slot.slice);
      setCanvasCursor(slot);
      return;
    }

    if (toolMode === "exclude") {
      updateCursorStatus(slot, uv, null);
      const name = pickSliceName(slot, uv);
      if (name !== slot.hoverName) {
        slot.hoverName = name;
        drawOneSlice(slot, slot.slice);
      }
      setCanvasCursor(slot);
      if (name) {
        const idx = arrayIndexByName(name);
        if (idx === 0) placeTip(slot, e.clientX, e.clientY, name + " · исходник (не исключается)");
        else if (idx >= 1) {
          const ex = excludedIndices.indexOf(idx) >= 0;
          placeTip(slot, e.clientX, e.clientY, name + (ex ? " · вернуть в вставку" : " · исключить из вставки"));
        } else placeTip(slot, e.clientX, e.clientY, name);
      } else hideTip(slot);
      return;
    }

    // pan: подсказка, что по телу можно сразу править
    if (toolMode === "pan" && uv && hitDraftBody(slot, uv) && isInteractiveBodyType(currentBodyTypeKey())) {
      updateCursorStatus(slot, uv, null);
      placeTip(slot, e.clientX, e.clientY, "клик — править тело");
      const name = pickSliceName(slot, uv);
      if (name !== slot.hoverName) {
        slot.hoverName = name;
        drawOneSlice(slot, slot.slice);
      }
      setCanvasCursor(slot);
      return;
    }

    slot.snap = null;
    updateCursorStatus(slot, uv, null);
    const name = pickSliceName(slot, uv);
    if (name !== slot.hoverName) {
      slot.hoverName = name;
      drawOneSlice(slot, slot.slice);
    }
    setCanvasCursor(slot);
    if (name) placeTip(slot, e.clientX, e.clientY, name);
    else hideTip(slot);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!slot.drag) return;
    const wasDrag = slot.drag;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    slot.drag = null;
    setCanvasCursor(slot);

    if (wasDrag.edit && editDrag) {
      editDrag = null;
      flushEditPreview();
      drawOneSlice(slot, slot.slice);
      return;
    }
    if (wasDrag.place) {
      const loc = canvasLocal(canvas, e.clientX, e.clientY);
      const uv = screenToUv(slot, loc.x, loc.y);
      if (uv) {
        const snap = snapUv(slot, uv, null);
        placeBodyAt(slot, snap);
      }
      return;
    }
    if (toolMode === "ruler" && !wasDrag.moved) {
      const loc = canvasLocal(canvas, e.clientX, e.clientY);
      const uv = screenToUv(slot, loc.x, loc.y);
      if (!uv) return;
      const anchor = slot.ruler && slot.ruler.p1 && !slot.ruler.p2 ? slot.ruler.p1 : null;
      const snap = snapUv(slot, uv, anchor);
      slot.snap = snap;
      if (!slot.ruler || slot.ruler.p2) {
        slot.ruler = { p1: { u: snap.u, v: snap.v }, p2: null };
      } else {
        slot.ruler.p2 = { u: snap.u, v: snap.v };
      }
      updateCursorStatus(slot, uv, snap);
      drawOneSlice(slot, slot.slice);
    }
    if (toolMode === "exclude" && !wasDrag.moved) {
      const loc = canvasLocal(canvas, e.clientX, e.clientY);
      const uv = screenToUv(slot, loc.x, loc.y);
      if (!uv) return;
      const name = pickSliceName(slot, uv);
      const idx = arrayIndexByName(name);
      if (idx >= 1 && toggleExclusion(idx)) sendPreview();
    }
  });

  canvas.addEventListener("pointercancel", () => {
    slot.drag = null;
    setCanvasCursor(slot);
  });

  canvas.addEventListener("pointerleave", () => {
    if (slot.drag) return;
    slot.cursorUv = null;
    if (toolMode !== "ruler") slot.snap = null;
    if (slot.hoverName) {
      slot.hoverName = null;
      drawOneSlice(slot, slot.slice);
    } else if (toolMode === "ruler") {
      drawOneSlice(slot, slot.slice);
    }
    hideTip(slot);
    setCanvasCursor(slot);
    updateCursorStatus(null, null, null);
  });

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    resetSliceView(slot);
    hideTip(slot);
    setCanvasCursor(slot);
    drawOneSlice(slot, slot.slice);
  });

  canvas.addEventListener("contextmenu", (e) => {
    if (toolMode !== "ruler") return;
    e.preventDefault();
    clearRuler(slot);
    updateCursorStatus(slot, slot.cursorUv, slot.snap);
    drawOneSlice(slot, slot.slice);
  });
}

function initSliceTools() {
  if (els.btnToolPan) {
    els.btnToolPan.addEventListener("click", () => setToolMode("pan"));
  }
  if (els.btnToolEdit) {
    els.btnToolEdit.title =
      "Правка уже размещённого тела: появятся ручки. Клик по телу на сечении тоже включает правку.";
    els.btnToolEdit.addEventListener("click", () => {
      placeBodyType = null;
      editDrag = null;
      setToolMode("edit");
      editHandlesPulseUntil = performance.now() + 1600;
      renderPrimPalette();
      drawSlices();
      const why = editHandlesBlockReason();
      if (els.cursorCoords) {
        els.cursorCoords.textContent = why || "Правка включена — тяните красный центр / жёлтые ручки / само тело";
      }
      if (!why) {
        // лёгкий повторный кадр, пока пульс ручек активен
        setTimeout(() => requestSliceDraw(), 200);
        setTimeout(() => requestSliceDraw(), 800);
        setTimeout(() => requestSliceDraw(), 1600);
      }
    });
  }
  if (els.btnToolExclude) {
    els.btnToolExclude.addEventListener("click", () => setToolMode("exclude"));
  }
  if (els.btnToolRuler) {
    els.btnToolRuler.title =
      "Линейка: две точки · snap к вершинам, серединам и центрам · H/V от первой точки";
    els.btnToolRuler.addEventListener("click", () => setToolMode("ruler"));
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toolMode === "ruler") {
      clearAllRulers();
      updateCursorStatus(null, null, null);
      requestSliceDraw();
    }
    if (e.key === "Escape" && (toolMode === "exclude" || toolMode === "place" || toolMode === "edit")) {
      placeBodyType = null;
      editDrag = null;
      setToolMode("pan");
    }
  });
  setToolMode("pan");
  renderPrimPalette();
}

sliceSlots.forEach(attachSliceNav);
initSliceTools();
initPatternUi();
window.addEventListener("resize", () => drawSlices());

if (els.bodyType) {
  els.bodyType.addEventListener("change", () => {
    sliceSlots.forEach(resetSliceView);
    placeBodyType = null;
    onTypeChange(false);
    if (toolMode === "edit" || toolMode === "place") renderPrimPalette();
    requestSliceDraw();
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
    vscode.postMessage({ type: "insert", form, pattern: form.pattern });
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
      const t = types.find((x) => x.key === els.bodyType.value);
      if (t) {
        els.typeDesc.textContent = t.description || "";
        rebuildParams(t.fields, msg.form.params);
      }
      applyPatternFromState(msg.form.pattern);
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
    if (msg.patternStatus) applyPatternStatus(msg.patternStatus);
    if (msg.arrayInstances) arrayInstances = msg.arrayInstances;
    else arrayInstances = [];
    if (Array.isArray(msg.patternExcludedIndices)) {
      excludedIndices = msg.patternExcludedIndices.slice();
      syncPatternExcludeUi();
    }
    if (msg.resetView) sliceSlots.forEach(resetSliceView);
    const dp = msg.draftPreview;
    const zp = msg.zonePreview;
    if (zp) {
      currentPreviewKind = "zone";
      slices = zp.slices || [];
      previewMeshes = zp.meshes || [];
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
      previewMeshes = dp.meshes || [];
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
        els.neighborInfo.textContent = n
          ? "соседей: " + n + " (яркость ∝ близости)"
          : "соседей нет";
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
      previewMeshes = [];
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
      applyPatternFromState(boot.form.pattern);
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
