/* global acquireVsCodeApi */
(function () {
const vscode = acquireVsCodeApi();

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
};

let types = [];
let constants = [];
let currentFields = [];
let slices = [];

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
  ctx.restore();

  ctx.fillStyle = "#9d9d9d";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(slice.uLabel || "U", cssW - 18, cssH - 6);
  ctx.fillText(slice.vLabel || "V", 6, 14);
}

function drawSlices() {
  sliceSlots.forEach((slot, i) => drawOneSlice(slot, slices[i] || null));
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
    const name = pickGrayBody(slot, screenToUv(slot, loc.x, loc.y));
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
    els.docLabel.textContent = msg.docLabel || "";
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
    if (msg.constants) {
      constants = msg.constants;
      fillEquList();
    }
    els.preview.textContent = msg.text || "";
    renderWarnings(msg.warnings || []);
    if (els.autoNameHint) {
      els.autoNameHint.textContent = msg.autoName ? "вставится как " + msg.autoName : "";
    }
    const dp = msg.draftPreview;
    if (dp) {
      slices = dp.slices || [];
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
    } else {
      slices = [];
      if (els.neighborInfo) els.neighborInfo.textContent = "";
      if (els.nearestInfo) els.nearestInfo.textContent = "ближайшее: —";
      drawSlices();
    }
  }
  if (msg.type === "error") {
    renderWarnings([msg.message || "Ошибка"]);
  }
});

(function applyBoot() {
  const bootEl = document.getElementById("bg-boot");
  if (!bootEl || !bootEl.textContent) return;
  try {
    const boot = JSON.parse(bootEl.textContent);
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
