/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const MIN_RES = 64;
  const MAX_RES = 1024;
  const DEFAULT_RES = 256;

  let SCENE = null;
  let MESH_PREVIEW = null;
  let viewMode = "2d";
  let sliceData = null;
  let colorBy = "material";
  let sliceAxis = "z";
  let slicePos = 0;
  let sliceResolution = DEFAULT_RES;
  let sliceDebounce = null;
  let queryDebounce = null;
  let activeZone = null;
  let activeBody = null;
  /** Видимая область в координатах u,v среза (подмножество sliceData.bounds). */
  let viewBounds = null;
  /** Доля полного среза (0–1), сохраняется между перерисовками для удержания зума. */
  let viewNorm = null;

  const sliceWrap = document.getElementById("slice-wrap");
  const sliceCanvas = document.getElementById("slice-canvas");
  const sliceCtx = sliceCanvas.getContext("2d");
  const view3dWrap = document.getElementById("view3d-wrap");
  const view3dCanvas = document.getElementById("view3d-canvas");
  const view3dCtx = view3dCanvas.getContext("2d");
  const legend = document.getElementById("legend");
  const info = document.getElementById("info");
  const hint = document.getElementById("hint");
  const unsupportedBadge = document.getElementById("unsupportedBadge");
  const meshStats = document.getElementById("meshStats");
  const toolbar2d = document.getElementById("toolbar-2d");
  const toolbar3d = document.getElementById("toolbar-3d");
  const mode2dBtn = document.getElementById("mode2d");
  const mode3dBtn = document.getElementById("mode3d");

  const MATERIAL_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  ];

  /* —— 3D orbit state —— */
  let orbitYaw = 0.6;
  let orbitPitch = 0.45;
  let orbitDist = 40;
  let orbitTarget = { x: 0, y: 0, z: 0 };
  let orbitDragging = false;
  let orbitMoved = false;
  let orbitLastX = 0;
  let orbitLastY = 0;

  function materialColor(n) {
    return MATERIAL_PALETTE[(n - 1) % MATERIAL_PALETTE.length];
  }

  function parseHexColor(hex) {
    const h = (hex || "#6699cc").replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }

  function zoneMetaColor(meta) {
    if (!meta) return parseHexColor("#1e1e2e");
    if (colorBy === "material" && meta.materialNum) {
      return parseHexColor(materialColor(meta.materialNum));
    }
    return parseHexColor(meta.color || "#6699cc");
  }

  function syncViewNormFromBounds() {
    if (!sliceData || !viewBounds) return;
    const b = sliceData.bounds;
    const du = b.uMax - b.uMin;
    const dv = b.vMax - b.vMin;
    if (du <= 0 || dv <= 0) return;
    viewNorm = {
      u0: (viewBounds.uMin - b.uMin) / du,
      u1: (viewBounds.uMax - b.uMin) / du,
      v0: (viewBounds.vMin - b.vMin) / dv,
      v1: (viewBounds.vMax - b.vMin) / dv,
    };
  }

  function applyViewNorm() {
    if (!sliceData || !viewNorm) return;
    const b = sliceData.bounds;
    const du = b.uMax - b.uMin;
    const dv = b.vMax - b.vMin;
    viewBounds = {
      uMin: b.uMin + viewNorm.u0 * du,
      uMax: b.uMin + viewNorm.u1 * du,
      vMin: b.vMin + viewNorm.v0 * dv,
      vMax: b.vMin + viewNorm.v1 * dv,
    };
    clampViewBounds();
    syncViewNormFromBounds();
  }

  function resetViewBounds() {
    if (!sliceData) {
      viewBounds = null;
      viewNorm = null;
      return;
    }
    const b = sliceData.bounds;
    viewBounds = { uMin: b.uMin, uMax: b.uMax, vMin: b.vMin, vMax: b.vMax };
    viewNorm = { u0: 0, u1: 1, v0: 0, v1: 1 };
  }

  function clampViewBounds() {
    if (!sliceData || !viewBounds) return;
    const b = sliceData.bounds;
    const minSpan = (b.uMax - b.uMin) / 2000;
    let uW = viewBounds.uMax - viewBounds.uMin;
    let vW = viewBounds.vMax - viewBounds.vMin;
    if (uW < minSpan) {
      const c = (viewBounds.uMin + viewBounds.uMax) / 2;
      viewBounds.uMin = c - minSpan / 2;
      viewBounds.uMax = c + minSpan / 2;
      uW = minSpan;
    }
    if (vW < minSpan) {
      const c = (viewBounds.vMin + viewBounds.vMax) / 2;
      viewBounds.vMin = c - minSpan / 2;
      viewBounds.vMax = c + minSpan / 2;
      vW = minSpan;
    }
    if (uW > b.uMax - b.uMin) {
      viewBounds.uMin = b.uMin;
      viewBounds.uMax = b.uMax;
    } else {
      if (viewBounds.uMin < b.uMin) {
        viewBounds.uMax += b.uMin - viewBounds.uMin;
        viewBounds.uMin = b.uMin;
      }
      if (viewBounds.uMax > b.uMax) {
        viewBounds.uMin -= viewBounds.uMax - b.uMax;
        viewBounds.uMax = b.uMax;
      }
    }
    if (vW > b.vMax - b.vMin) {
      viewBounds.vMin = b.vMin;
      viewBounds.vMax = b.vMax;
    } else {
      if (viewBounds.vMin < b.vMin) {
        viewBounds.vMax += b.vMin - viewBounds.vMin;
        viewBounds.vMin = b.vMin;
      }
      if (viewBounds.vMax > b.vMax) {
        viewBounds.vMin -= viewBounds.vMax - b.vMax;
        viewBounds.vMax = b.vMax;
      }
    }
    syncViewNormFromBounds();
  }

  function sampleZoneIndex(u, v) {
    if (!sliceData) return 0;
    const b = sliceData.bounds;
    const res = sliceData.resolution;
    if (u < b.uMin || u > b.uMax || v < b.vMin || v > b.vMax) return 0;
    const col = Math.min(res - 1, Math.max(0, Math.floor(((u - b.uMin) / (b.uMax - b.uMin)) * res)));
    const row = Math.min(res - 1, Math.max(0, Math.floor(((b.vMax - v) / (b.vMax - b.vMin)) * res)));
    return sliceData.grid[row][col];
  }

  function drawSliceViewport() {
    if (!sliceData || !viewBounds || viewMode !== "2d") return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, sliceWrap.clientWidth);
    const cssH = Math.max(1, sliceWrap.clientHeight);
    const pxW = Math.floor(cssW * dpr);
    const pxH = Math.floor(cssH * dpr);
    sliceCanvas.width = pxW;
    sliceCanvas.height = pxH;
    sliceCanvas.style.width = cssW + "px";
    sliceCanvas.style.height = cssH + "px";

    const img = sliceCtx.createImageData(pxW, pxH);
    const vb = viewBounds;
    const activeName = activeZone;

    for (let row = 0; row < pxH; row++) {
      const v = vb.vMax - ((row + 0.5) / pxH) * (vb.vMax - vb.vMin);
      for (let col = 0; col < pxW; col++) {
        const u = vb.uMin + ((col + 0.5) / pxW) * (vb.uMax - vb.uMin);
        const idx = sampleZoneIndex(u, v);
        const meta = sliceData.zoneIndex.find((z) => z.index === idx) || sliceData.zoneIndex[0];
        let c = zoneMetaColor(meta);
        if (activeName && meta.name !== activeName && meta.name !== "(вне зон)") {
          c = { r: c.r * 0.35, g: c.g * 0.35, b: c.b * 0.35 };
        }
        const px = (row * pxW + col) * 4;
        img.data[px] = Math.floor(c.r * 255);
        img.data[px + 1] = Math.floor(c.g * 255);
        img.data[px + 2] = Math.floor(c.b * 255);
        img.data[px + 3] = 255;
      }
    }
    sliceCtx.putImageData(img, 0, 0);
  }

  function updateSliceSlider() {
    if (!SCENE || !SCENE.bbox) return;
    const b = SCENE.bbox;
    const slider = document.getElementById("slicePos");
    const label = document.getElementById("slicePosLabel");
    let min;
    let max;
    if (sliceAxis === "z") {
      min = b.min.z;
      max = b.max.z;
    } else if (sliceAxis === "y") {
      min = b.min.y;
      max = b.max.y;
    } else {
      min = b.min.x;
      max = b.max.x;
    }
    slider.min = String(min);
    slider.max = String(max);
    slider.step = "0.1";
    if (slicePos < min || slicePos > max) slicePos = (min + max) / 2;
    slider.value = String(slicePos);
    label.textContent = sliceAxis.toUpperCase() + "=" + Number(slicePos).toFixed(1);
  }

  function renderUnsupportedBadge() {
    if (!MESH_PREVIEW || !MESH_PREVIEW.unsupported || !MESH_PREVIEW.unsupported.length) {
      unsupportedBadge.hidden = true;
      unsupportedBadge.innerHTML = "";
      return;
    }
    const byType = {};
    MESH_PREVIEW.unsupported.forEach((u) => {
      byType[u.bodyType] = (byType[u.bodyType] || 0) + 1;
    });
    const parts = Object.keys(byType)
      .sort()
      .map((t) => t + "×" + byType[t]);
    unsupportedBadge.hidden = false;
    unsupportedBadge.innerHTML =
      '<span class="badge-label">не в 3D</span> ' +
      parts.join(", ") +
      '<div class="badge-list">' +
      MESH_PREVIEW.unsupported
        .slice(0, 40)
        .map((u) => '<span class="badge-item">' + u.name + " (" + u.bodyType + ")</span>")
        .join("") +
      (MESH_PREVIEW.unsupported.length > 40
        ? '<span class="badge-item">… +' + (MESH_PREVIEW.unsupported.length - 40) + "</span>"
        : "") +
      "</div>";
  }

  function renderLegend() {
    if (!SCENE) return;
    let html = "";
    if (viewMode === "3d") {
      html += "<b>Тела</b><br>";
      const meshes = (MESH_PREVIEW && MESH_PREVIEW.meshes) || [];
      meshes.forEach((m) => {
        const cls = activeBody === m.name ? "zone-item active" : "zone-item";
        html +=
          '<div class="' +
          cls +
          '" data-body="' +
          m.name +
          '"><span style="color:' +
          (m.color || "#6699cc") +
          '">■</span> ' +
          m.name +
          " <span class=\"muted\">" +
          m.bodyType +
          "</span></div>";
      });
      if (!meshes.length) {
        html += '<span class="muted">Нет мешей для отрисовки</span><br>';
      }
    } else {
      html += "<b>Зоны</b><br>";
      (SCENE.zones || []).forEach((z) => {
        const cls = activeZone === z.name ? "zone-item active" : "zone-item";
        html +=
          '<div class="' +
          cls +
          '" data-zone="' +
          z.name +
          '"><span style="color:' +
          z.color +
          '">■</span> ' +
          z.name +
          " (M" +
          (z.materialNum || "?") +
          ", Z" +
          (z.regNum || "?") +
          ")</div>";
      });
    }
    if ((SCENE.materials || []).length) {
      html += "<br><b>Материалы</b><br>";
      SCENE.materials.forEach((m) => {
        html += "M" + m.number + ": " + m.nuclides.map((n) => n.name).join(", ") + "<br>";
      });
    }
    legend.innerHTML = html;
    legend.querySelectorAll("[data-zone]").forEach((el) => {
      el.addEventListener("click", () => {
        activeZone = el.getAttribute("data-zone");
        activeBody = null;
        renderLegend();
        drawSliceViewport();
      });
    });
    legend.querySelectorAll("[data-body]").forEach((el) => {
      el.addEventListener("click", () => {
        activeBody = el.getAttribute("data-body");
        renderLegend();
        draw3d();
      });
    });
  }

  function showPointInfo(data) {
    if (!data) {
      info.innerHTML =
        viewMode === "3d"
          ? '<span class="label">ЛКМ — орбита · колёсико — зум · список тел справа</span>'
          : '<span class="label">Кликните на срезе для проверки точки</span>';
      return;
    }
    const p = data.point;
    let html = '<div><span class="label">Точка:</span> (' + fmt(p.x) + ", " + fmt(p.y) + ", " + fmt(p.z) + ")</div>";
    if (data.zone) {
      html += '<div><span class="label">Зона:</span> ' + data.zone.name + " — " + data.zone.expression + "</div>";
      html +=
        '<div><span class="label">Материал №:</span> ' +
        (data.zone.materialNum ?? "?") +
        ' | <span class="label">Рег.:</span> ' +
        (data.zone.regNum ?? "?") +
        ' | <span class="label">Объект:</span> ' +
        (data.zone.objNum ?? data.objectNum ?? "?") +
        "</div>";
    } else {
      html += '<div><span class="label">Зона:</span> (вне зон)</div>';
    }
    if (data.material) {
      html +=
        '<div><span class="label">Состав:</span> ' +
        data.material.nuclides.map((n) => n.name).join(", ") +
        "</div>";
    }
    if (data.bodyHits && data.bodyHits.length) {
      html += '<div><span class="label">Тела:</span> ' + data.bodyHits.join(", ") + "</div>";
    }
    info.innerHTML = html;
  }

  function fmt(n) {
    return Number(n).toFixed(3);
  }

  function requestQueryPoint(x, y, z) {
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
      vscode.postMessage({ type: "queryPoint", x, y, z });
    }, 150);
  }

  function requestSlice() {
    clearTimeout(sliceDebounce);
    sliceDebounce = setTimeout(() => {
      vscode.postMessage({
        type: "getSlice",
        axis: sliceAxis,
        position: slicePos,
        resolution: sliceResolution,
      });
    }, 200);
  }

  function onSliceResult(data) {
    const hadZoom = viewNorm !== null;
    sliceData = data;
    if (hadZoom) {
      applyViewNorm();
    } else {
      resetViewBounds();
    }
    drawSliceViewport();
  }

  /* ========== 3D wireframe (no Three.js — CSP) ========== */

  function sceneExtent() {
    if (!SCENE || !SCENE.bbox) return 20;
    const b = SCENE.bbox;
    const dx = b.max.x - b.min.x;
    const dy = b.max.y - b.min.y;
    const dz = b.max.z - b.min.z;
    return Math.max(dx, dy, dz, 1);
  }

  function resetOrbit() {
    if (!SCENE || !SCENE.bbox) {
      orbitTarget = { x: 0, y: 0, z: 0 };
      orbitDist = 40;
    } else {
      const b = SCENE.bbox;
      orbitTarget = {
        x: (b.min.x + b.max.x) / 2,
        y: (b.min.y + b.max.y) / 2,
        z: (b.min.z + b.max.z) / 2,
      };
      orbitDist = sceneExtent() * 2.2;
    }
    orbitYaw = 0.6;
    orbitPitch = 0.45;
  }

  function cameraPos() {
    const cp = Math.cos(orbitPitch);
    return {
      x: orbitTarget.x + orbitDist * cp * Math.cos(orbitYaw),
      y: orbitTarget.y + orbitDist * cp * Math.sin(orbitYaw),
      z: orbitTarget.z + orbitDist * Math.sin(orbitPitch),
    };
  }

  function projectPoint(p, cam, w, h) {
    const fx = orbitTarget.x - cam.x;
    const fy = orbitTarget.y - cam.y;
    const fz = orbitTarget.z - cam.z;
    const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    const forward = { x: fx / fLen, y: fy / fLen, z: fz / fLen };
    const upWorld = { x: 0, y: 0, z: 1 };
    let right = {
      x: forward.y * upWorld.z - forward.z * upWorld.y,
      y: forward.z * upWorld.x - forward.x * upWorld.z,
      z: forward.x * upWorld.y - forward.y * upWorld.x,
    };
    let rLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
    if (rLen < 1e-8) {
      right = { x: 1, y: 0, z: 0 };
      rLen = 1;
    }
    right.x /= rLen;
    right.y /= rLen;
    right.z /= rLen;
    const up = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    const dx = p.x - cam.x;
    const dy = p.y - cam.y;
    const dz = p.z - cam.z;
    const zx = dx * forward.x + dy * forward.y + dz * forward.z;
    if (zx <= 0.05) return null;
    const xx = dx * right.x + dy * right.y + dz * right.z;
    const yy = dx * up.x + dy * up.y + dz * up.z;
    const fov = 1.1;
    const scale = Math.min(w, h) * 0.45 * (orbitDist / (zx * fov));
    return {
      x: w / 2 + xx * scale,
      y: h / 2 - yy * scale,
      z: zx,
    };
  }

  function drawEdges(ctx, edges, cam, w, h, color, highlight) {
    const alpha = highlight ? 1 : 0.75;
    const lw = highlight ? 2.2 : 1.1;
    edges.forEach((edge) => {
      const a = projectPoint(edge[0], cam, w, h);
      const b = projectPoint(edge[1], cam, w, h);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function boxEdges(center, size) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const c = [
      { x: center.x - hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y + hy, z: center.z + hz },
      { x: center.x - hx, y: center.y + hy, z: center.z + hz },
    ];
    const idx = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    return idx.map(([i, j]) => [c[i], c[j]]);
  }

  function orientedBoxEdges(corner, edges) {
    const e1 = edges[0];
    const e2 = edges[1];
    const e3 = edges[2];
    const o = corner;
    const p = (a, b, c) => ({
      x: o.x + a * e1.x + b * e2.x + c * e3.x,
      y: o.y + a * e1.y + b * e2.y + c * e3.y,
      z: o.z + a * e1.z + b * e2.z + c * e3.z,
    });
    const v = [p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)];
    const idx = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    return idx.map(([i, j]) => [v[i], v[j]]);
  }

  function sphereEdges(center, radius, seg) {
    const edges = [];
    const rings = [
      { n: { x: 1, y: 0, z: 0 }, u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 } },
      { n: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 } },
      { n: { x: 0, y: 0, z: 1 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } },
    ];
    rings.forEach((ring) => {
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pts.push({
          x: center.x + radius * (Math.cos(a) * ring.u.x + Math.sin(a) * ring.v.x),
          y: center.y + radius * (Math.cos(a) * ring.u.y + Math.sin(a) * ring.v.y),
          z: center.z + radius * (Math.cos(a) * ring.u.z + Math.sin(a) * ring.v.z),
        });
      }
      for (let i = 0; i < seg; i++) edges.push([pts[i], pts[i + 1]]);
    });
    return edges;
  }

  function cylinderEdges(center, axis, radius, height, seg) {
    const ax = axis || { x: 0, y: 0, z: 1 };
    const L = Math.sqrt(ax.x * ax.x + ax.y * ax.y + ax.z * ax.z) || 1;
    const uz = { x: ax.x / L, y: ax.y / L, z: ax.z / L };
    let ux = { x: 1, y: 0, z: 0 };
    if (Math.abs(uz.x) > 0.9) ux = { x: 0, y: 1, z: 0 };
    const cross = (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    });
    let uy = cross(uz, ux);
    let uyL = Math.sqrt(uy.x * uy.x + uy.y * uy.y + uy.z * uy.z) || 1;
    uy = { x: uy.x / uyL, y: uy.y / uyL, z: uy.z / uyL };
    ux = cross(uy, uz);
    const h2 = height / 2;
    const bot = [];
    const top = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = Math.cos(a) * radius;
      const cy = Math.sin(a) * radius;
      bot.push({
        x: center.x - uz.x * h2 + ux.x * cx + uy.x * cy,
        y: center.y - uz.y * h2 + ux.y * cx + uy.y * cy,
        z: center.z - uz.z * h2 + ux.z * cx + uy.z * cy,
      });
      top.push({
        x: center.x + uz.x * h2 + ux.x * cx + uy.x * cy,
        y: center.y + uz.y * h2 + ux.y * cx + uy.y * cy,
        z: center.z + uz.z * h2 + ux.z * cx + uy.z * cy,
      });
    }
    const edges = [];
    for (let i = 0; i < seg; i++) {
      edges.push([bot[i], bot[i + 1]]);
      edges.push([top[i], top[i + 1]]);
    }
    for (let i = 0; i < 4; i++) {
      const idx = Math.floor((i * seg) / 4);
      edges.push([bot[idx], top[idx]]);
    }
    return edges;
  }

  function hexEdges(center, flatToFlat, height, rotation) {
    const R = (flatToFlat || 1) / Math.sqrt(3);
    const h2 = (height || 1) / 2;
    const bot = [];
    const top = [];
    for (let i = 0; i < 6; i++) {
      const a = rotation + (i * Math.PI) / 3;
      const x = center.x + R * Math.cos(a);
      const y = center.y + R * Math.sin(a);
      bot.push({ x, y, z: center.z - h2 });
      top.push({ x, y, z: center.z + h2 });
    }
    const edges = [];
    for (let i = 0; i < 6; i++) {
      edges.push([bot[i], bot[(i + 1) % 6]]);
      edges.push([top[i], top[(i + 1) % 6]]);
      edges.push([bot[i], top[i]]);
    }
    return edges;
  }

  function planeEdges(center, normal, size) {
    const n = normal || { x: 0, y: 0, z: 1 };
    const L = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
    const nz = { x: n.x / L, y: n.y / L, z: n.z / L };
    let ux = { x: 1, y: 0, z: 0 };
    if (Math.abs(nz.x) > 0.9) ux = { x: 0, y: 1, z: 0 };
    const cross = (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    });
    let uy = cross(nz, ux);
    let uyL = Math.sqrt(uy.x * uy.x + uy.y * uy.y + uy.z * uy.z) || 1;
    uy = { x: uy.x / uyL, y: uy.y / uyL, z: uy.z / uyL };
    ux = cross(uy, nz);
    const sx = ((size && size.x) || sceneExtent()) * 0.4;
    const sy = ((size && size.y) || sceneExtent()) * 0.4;
    const corners = [
      { x: center.x - ux.x * sx - uy.x * sy, y: center.y - ux.y * sx - uy.y * sy, z: center.z - ux.z * sx - uy.z * sy },
      { x: center.x + ux.x * sx - uy.x * sy, y: center.y + ux.y * sx - uy.y * sy, z: center.z + ux.z * sx - uy.z * sy },
      { x: center.x + ux.x * sx + uy.x * sy, y: center.y + ux.y * sx + uy.y * sy, z: center.z + ux.z * sx + uy.z * sy },
      { x: center.x - ux.x * sx + uy.x * sy, y: center.y - ux.y * sx + uy.y * sy, z: center.z - ux.z * sx + uy.z * sy },
    ];
    return [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
      [corners[2], corners[3]],
      [corners[3], corners[0]],
      [corners[0], corners[2]],
    ];
  }

  function meshToEdges(m) {
    if (m.kind === "box" || m.kind === "bbox") {
      return boxEdges(m.center, m.size || { x: 1, y: 1, z: 1 });
    }
    if (m.kind === "orientedBox" && m.corner && m.edges) {
      return orientedBoxEdges(m.corner, m.edges);
    }
    if (m.kind === "sphere") {
      return sphereEdges(m.center, m.radius || 1, 24);
    }
    if (m.kind === "cylinder") {
      return cylinderEdges(m.center, m.axis, m.radius || 1, m.height || 1, 20);
    }
    if (m.kind === "hex") {
      return hexEdges(m.center, m.flatToFlat, m.height, m.rotation || 0);
    }
    if (m.kind === "plane") {
      return planeEdges(m.center, m.normal, m.size);
    }
    return boxEdges(m.center, m.size || { x: 1, y: 1, z: 1 });
  }

  function drawAxes(ctx, cam, w, h) {
    const o = orbitTarget;
    const len = sceneExtent() * 0.25;
    const axes = [
      [{ x: o.x, y: o.y, z: o.z }, { x: o.x + len, y: o.y, z: o.z }, "#e64553"],
      [{ x: o.x, y: o.y, z: o.z }, { x: o.x, y: o.y + len, z: o.z }, "#40a02b"],
      [{ x: o.x, y: o.y, z: o.z }, { x: o.x, y: o.y, z: o.z + len }, "#1e66f5"],
    ];
    axes.forEach(([a, b, col]) => {
      const pa = projectPoint(a, cam, w, h);
      const pb = projectPoint(b, cam, w, h);
      if (!pa || !pb) return;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function draw3d() {
    if (viewMode !== "3d") return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, view3dWrap.clientWidth);
    const cssH = Math.max(1, view3dWrap.clientHeight);
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    view3dCanvas.width = w;
    view3dCanvas.height = h;
    view3dCanvas.style.width = cssW + "px";
    view3dCanvas.style.height = cssH + "px";

    view3dCtx.fillStyle = "#11111b";
    view3dCtx.fillRect(0, 0, w, h);

    const cam = cameraPos();
    drawAxes(view3dCtx, cam, w, h);

    if (SCENE && SCENE.bbox) {
      const b = SCENE.bbox;
      const center = {
        x: (b.min.x + b.max.x) / 2,
        y: (b.min.y + b.max.y) / 2,
        z: (b.min.z + b.max.z) / 2,
      };
      const size = {
        x: b.max.x - b.min.x,
        y: b.max.y - b.min.y,
        z: b.max.z - b.min.z,
      };
      drawEdges(view3dCtx, boxEdges(center, size), cam, w, h, "#45475a", false);
    }

    const meshes = (MESH_PREVIEW && MESH_PREVIEW.meshes) || [];
    meshes.forEach((m) => {
      const highlight = activeBody === m.name;
      const dim = activeBody && !highlight;
      const color = m.color || "#89b4fa";
      drawEdges(view3dCtx, meshToEdges(m), cam, w, h, dim ? "#585b70" : color, highlight);
    });
  }

  function updateMeshStats() {
    if (!MESH_PREVIEW) {
      meshStats.textContent = "";
      return;
    }
    const p = MESH_PREVIEW;
    let t = "мешей: " + p.meshes.length + " / тел: " + p.totalBodies;
    if (p.unsupported.length) t += " · не в 3D: " + p.unsupported.length;
    if (p.detailSkipped) t += " · упрощено";
    meshStats.textContent = t;
  }

  function applyModeUi() {
    const is3d = viewMode === "3d";
    toolbar2d.hidden = is3d;
    toolbar3d.hidden = !is3d;
    sliceWrap.hidden = is3d;
    view3dWrap.hidden = !is3d;
    mode2dBtn.classList.toggle("active", !is3d);
    mode3dBtn.classList.toggle("active", is3d);
    hint.textContent = is3d
      ? "ЛКМ — орбита · колёсико — зум · клик по телу в списке"
      : "Колёсико — зум к курсору · Shift+ЛКМ — сдвиг";
    renderUnsupportedBadge();
    renderLegend();
    updateMeshStats();
    if (is3d) {
      draw3d();
      showPointInfo(null);
    } else {
      drawSliceViewport();
    }
  }

  function setViewMode(mode, fromHost) {
    if (mode !== "2d" && mode !== "3d") return;
    if (mode === viewMode && fromHost) {
      applyModeUi();
      return;
    }
    if (mode === "3d" && !fromHost) {
      vscode.postMessage({ type: "setMode", mode: "3d" });
      return;
    }
    viewMode = mode;
    applyModeUi();
    if (!fromHost && mode === "2d") {
      vscode.postMessage({ type: "setMode", mode: "2d" });
    }
    if (mode === "2d" && SCENE) requestSlice();
  }

  function initScene(scene, meshPreview, mode) {
    const isRefresh = !!SCENE;
    SCENE = scene;
    MESH_PREVIEW = meshPreview || { meshes: [], unsupported: [], totalBodies: 0, detailSkipped: false, bodyCap: 500 };
    if (!isRefresh) {
      slicePos = scene.bbox ? (scene.bbox.min.z + scene.bbox.max.z) / 2 : 0;
      activeZone = null;
      activeBody = null;
      resetOrbit();
      showPointInfo(null);
    } else if (viewMode === "3d") {
      /* keep orbit on refresh */
    }
    if (mode === "2d" || mode === "3d") {
      viewMode = mode;
    }
    applyModeUi();
    updateSliceSlider();
    if (viewMode === "2d") requestSlice();
  }

  function canvasClientToWorld(clientX, clientY) {
    if (!viewBounds) return null;
    const rect = sliceCanvas.getBoundingClientRect();
    const rx = (clientX - rect.left) / rect.width;
    const ry = (clientY - rect.top) / rect.height;
    return {
      u: viewBounds.uMin + rx * (viewBounds.uMax - viewBounds.uMin),
      v: viewBounds.vMax - ry * (viewBounds.vMax - viewBounds.vMin),
    };
  }

  function zoomAt(clientX, clientY, factor) {
    if (!viewBounds) return;
    const w = canvasClientToWorld(clientX, clientY);
    if (!w) return;
    const rx = (w.u - viewBounds.uMin) / (viewBounds.uMax - viewBounds.uMin);
    const ry = (viewBounds.vMax - w.v) / (viewBounds.vMax - viewBounds.vMin);
    const newUw = (viewBounds.uMax - viewBounds.uMin) * factor;
    const newVw = (viewBounds.vMax - viewBounds.vMin) * factor;
    viewBounds.uMin = w.u - rx * newUw;
    viewBounds.uMax = w.u + (1 - rx) * newUw;
    viewBounds.vMin = w.v - (1 - ry) * newVw;
    viewBounds.vMax = w.v + ry * newVw;
    clampViewBounds();
    drawSliceViewport();
  }

  sliceCanvas.addEventListener("wheel", (e) => {
    if (viewMode !== "2d") return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  let panning = false;
  let panMoved = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartBounds = null;

  sliceCanvas.addEventListener("mousedown", (e) => {
    if (viewMode !== "2d") return;
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      panning = true;
      panMoved = false;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartBounds = { ...viewBounds };
    }
  });
  window.addEventListener("mouseup", () => {
    panning = false;
    panStartBounds = null;
    orbitDragging = false;
  });
  window.addEventListener("mousemove", (e) => {
    if (panning && panStartBounds && viewBounds && viewMode === "2d") {
      if (Math.abs(e.clientX - panStartX) > 2 || Math.abs(e.clientY - panStartY) > 2) {
        panMoved = true;
      }
      const rect = sliceCanvas.getBoundingClientRect();
      const du = -((e.clientX - panStartX) / rect.width) * (panStartBounds.uMax - panStartBounds.uMin);
      const dv = ((e.clientY - panStartY) / rect.height) * (panStartBounds.vMax - panStartBounds.vMin);
      viewBounds.uMin = panStartBounds.uMin + du;
      viewBounds.uMax = panStartBounds.uMax + du;
      viewBounds.vMin = panStartBounds.vMin + dv;
      viewBounds.vMax = panStartBounds.vMax + dv;
      clampViewBounds();
      drawSliceViewport();
      return;
    }
    if (orbitDragging && viewMode === "3d") {
      const dx = e.clientX - orbitLastX;
      const dy = e.clientY - orbitLastY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) orbitMoved = true;
      orbitYaw += dx * 0.008;
      orbitPitch = Math.max(-1.4, Math.min(1.4, orbitPitch + dy * 0.008));
      orbitLastX = e.clientX;
      orbitLastY = e.clientY;
      draw3d();
    }
  });

  sliceCanvas.addEventListener("click", (e) => {
    if (viewMode !== "2d" || panMoved) return;
    const w = canvasClientToWorld(e.clientX, e.clientY);
    if (!w) return;
    let x;
    let y;
    let z;
    if (sliceAxis === "z") {
      x = w.u;
      y = w.v;
      z = slicePos;
    } else if (sliceAxis === "y") {
      x = w.u;
      y = slicePos;
      z = w.v;
    } else {
      x = slicePos;
      y = w.u;
      z = w.v;
    }
    document.getElementById("ptX").value = x.toFixed(3);
    document.getElementById("ptY").value = y.toFixed(3);
    document.getElementById("ptZ").value = z.toFixed(3);
    requestQueryPoint(x, y, z);
  });

  view3dCanvas.addEventListener("mousedown", (e) => {
    if (viewMode !== "3d" || e.button !== 0) return;
    orbitDragging = true;
    orbitMoved = false;
    orbitLastX = e.clientX;
    orbitLastY = e.clientY;
  });

  view3dCanvas.addEventListener("wheel", (e) => {
    if (viewMode !== "3d") return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.9 : 1 / 0.9;
    orbitDist = Math.max(sceneExtent() * 0.2, Math.min(sceneExtent() * 40, orbitDist * factor));
    draw3d();
  }, { passive: false });

  mode2dBtn.addEventListener("click", () => setViewMode("2d", false));
  mode3dBtn.addEventListener("click", () => setViewMode("3d", false));

  document.getElementById("plane").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "sliceXY") sliceAxis = "z";
    else if (v === "sliceXZ") sliceAxis = "y";
    else if (v === "sliceYZ") sliceAxis = "x";
    updateSliceSlider();
    requestSlice();
  });

  document.getElementById("slicePos").addEventListener("input", (e) => {
    slicePos = parseFloat(e.target.value);
    document.getElementById("slicePosLabel").textContent = sliceAxis.toUpperCase() + "=" + slicePos.toFixed(1);
    requestSlice();
  });

  document.getElementById("resolution").addEventListener("change", (e) => {
    const n = parseInt(e.target.value, 10);
    if (n >= MIN_RES && n <= MAX_RES) {
      sliceResolution = n;
      requestSlice();
    }
  });

  document.getElementById("colorBy").addEventListener("change", (e) => {
    colorBy = e.target.value;
    drawSliceViewport();
  });

  document.getElementById("resetView").addEventListener("click", () => {
    resetViewBounds();
    drawSliceViewport();
  });

  document.getElementById("resetOrbit").addEventListener("click", () => {
    resetOrbit();
    draw3d();
  });

  document.getElementById("queryBtn").addEventListener("click", () => {
    const x = parseFloat(document.getElementById("ptX").value);
    const y = parseFloat(document.getElementById("ptY").value);
    const z = parseFloat(document.getElementById("ptZ").value);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) requestQueryPoint(x, y, z);
  });

  window.addEventListener("resize", () => {
    if (viewMode === "3d") draw3d();
    else drawSliceViewport();
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "scene") {
      initScene(msg.scene, msg.meshPreview, msg.mode);
    }
    if (msg.type === "pointResult") showPointInfo(msg.result);
    if (msg.type === "sliceResult") onSliceResult(msg.slice);
    if (msg.type === "modeChanged") setViewMode(msg.mode, true);
    if (msg.type === "modeRejected") {
      viewMode = "2d";
      applyModeUi();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
