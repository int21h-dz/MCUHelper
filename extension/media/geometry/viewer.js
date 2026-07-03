/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const MIN_RES = 64;
  const MAX_RES = 1024;
  const DEFAULT_RES = 256;

  let SCENE = null;
  let sliceData = null;
  let colorBy = "material";
  let sliceAxis = "z";
  let slicePos = 0;
  let sliceResolution = DEFAULT_RES;
  let sliceDebounce = null;
  let queryDebounce = null;
  let activeZone = null;
  /** Видимая область в координатах u,v среза (подмножество sliceData.bounds). */
  let viewBounds = null;
  /** Доля полного среза (0–1), сохраняется между перерисовками для удержания зума. */
  let viewNorm = null;

  const sliceWrap = document.getElementById("slice-wrap");
  const sliceCanvas = document.getElementById("slice-canvas");
  const sliceCtx = sliceCanvas.getContext("2d");
  const legend = document.getElementById("legend");
  const info = document.getElementById("info");

  const MATERIAL_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  ];

  function materialColor(n) {
    return MATERIAL_PALETTE[(n - 1) % MATERIAL_PALETTE.length];
  }

  function parseHexColor(hex) {
    const h = hex.replace("#", "");
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
    if (!sliceData || !viewBounds) return;
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

  function renderLegend() {
    if (!SCENE) return;
    let html = "<b>Зоны</b><br>";
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
    if ((SCENE.materials || []).length) {
      html += "<br><b>Материалы</b><br>";
      SCENE.materials.forEach((m) => {
        html += "M" + m.number + ": " + m.nuclides.map((n) => n.name).join(", ") + "<br>";
      });
    }
    legend.innerHTML = html;
    legend.querySelectorAll(".zone-item").forEach((el) => {
      el.addEventListener("click", () => {
        activeZone = el.getAttribute("data-zone");
        renderLegend();
        drawSliceViewport();
      });
    });
  }

  function showPointInfo(data) {
    if (!data) {
      info.innerHTML = '<span class="label">Кликните на срезе для проверки точки</span>';
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

  function initScene(scene) {
    const isRefresh = !!SCENE;
    SCENE = scene;
    if (!isRefresh) {
      slicePos = scene.bbox ? (scene.bbox.min.z + scene.bbox.max.z) / 2 : 0;
      activeZone = null;
      showPointInfo(null);
    }
    renderLegend();
    updateSliceSlider();
    requestSlice();
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
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning || !panStartBounds || !viewBounds) return;
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
  });

  sliceCanvas.addEventListener("click", (e) => {
    if (panMoved) return;
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

  document.getElementById("queryBtn").addEventListener("click", () => {
    const x = parseFloat(document.getElementById("ptX").value);
    const y = parseFloat(document.getElementById("ptY").value);
    const z = parseFloat(document.getElementById("ptZ").value);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) requestQueryPoint(x, y, z);
  });

  window.addEventListener("resize", () => drawSliceViewport());

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "scene") initScene(msg.scene);
    if (msg.type === "pointResult") showPointInfo(msg.result);
    if (msg.type === "sliceResult") onSliceResult(msg.slice);
  });

  vscode.postMessage({ type: "ready" });
})();
