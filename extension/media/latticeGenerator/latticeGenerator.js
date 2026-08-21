/* Webview: конструктор LATT GLTL (UserGuide §9.2.6.1) */
(function () {
  const vscode = acquireVsCodeApi();

  const PALETTE = [
    "#7ec8e3",
    "#f0a06a",
    "#8fd19e",
    "#d4a5ff",
    "#f2d675",
    "#f09595",
    "#9ad7c2",
    "#b8c4ff",
  ];

  let form = null;
  let context = {
    lcellNames: [],
    zoneNames: [],
    docLabel: "",
    canReplace: false,
    boundLabel: "",
  };
  let preview = { text: "", warnings: [], okToInsert: false, canReplace: false };
  let debounceTimer = null;
  let plotTimer = null;

  const root = document.getElementById("root");

  function colorFor(name) {
    if (!name) return "#888";
    const els = form?.elements || [];
    let idx = els.indexOf(name);
    if (idx < 0) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
      idx = Math.abs(h) % PALETTE.length;
    }
    return PALETTE[idx % PALETTE.length];
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function protoIndexOf(p) {
    if (p.protoIndex && p.protoIndex >= 1) return p.protoIndex;
    const i = form.elements.indexOf(p.element);
    return i >= 0 ? i + 1 : 1;
  }

  function readFormFromDom() {
    if (!form) return;
    form.latticeType = "GLTL";
    form.zoneName = root.querySelector("#zoneName")?.value?.trim() || "ZL";
    form.lfixso = root.querySelector("#lfixso")?.value?.trim() || "";
    form.lblack = root.querySelector("#lblack")?.value?.trim() || "";

    const rows = root.querySelectorAll(".lg-place-row");
    form.placements = [];
    rows.forEach((row) => {
      const idx = Math.max(1, parseInt(row.querySelector(".pl-n")?.value || "1", 10) || 1);
      const el = form.elements[idx - 1] || form.elements[0] || "";
      form.placements.push({
        element: el,
        protoIndex: idx,
        x: row.querySelector(".pl-x")?.value || "0",
        y: row.querySelector(".pl-y")?.value || "0",
        z: row.querySelector(".pl-z")?.value || "0",
      });
    });
  }

  function schedulePush() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      readFormFromDom();
      vscode.postMessage({ type: "setForm", form: form });
    }, 120);
  }


  function onChange() {
    readFormFromDom();
    schedulePlotRefresh();
    schedulePush();
  }

  function addElement(name) {
    const n = String(name || "").trim();
    if (!n) return;
    if (!form.elements.includes(n)) form.elements.push(n);
    render();
    schedulePush();
  }

  function removeElement(name) {
    const idx = form.elements.indexOf(name);
    if (idx < 0) return;
    form.elements = form.elements.filter((e) => e !== name);
    form.placements = (form.placements || []).map((p) => {
      let pi = protoIndexOf(p);
      if (pi === idx + 1) pi = 1;
      else if (pi > idx + 1) pi -= 1;
      return {
        ...p,
        protoIndex: pi,
        element: form.elements[pi - 1] || form.elements[0] || "",
      };
    });
    render();
    schedulePush();
  }

  function chipHtml(name, index1) {
    const col = colorFor(name);
    return (
      '<span class="lg-chip" draggable="true" data-drag-proto="' +
      escapeHtml(name) +
      '" data-drag-idx="' +
      index1 +
      '" style="background:' +
      col +
      ';color:#111" title="Перетащите на поле превью">' +
      "<b>/" +
      index1 +
      "</b> " +
      escapeHtml(name) +
      ' <span class="x" data-remove="' +
      escapeHtml(name) +
      '" title="Убрать из LISTEL">×</span></span>'
    );
  }

  function placementsHtml() {
    const nOpts = form.elements
      .map((e, i) => {
        const n = i + 1;
        return '<option value="' + n + '">/' + n + " " + escapeHtml(e) + "</option>";
      })
      .join("");

    const rows = (form.placements || [])
      .map((p, idx) => {
        const n = protoIndexOf(p);
        const opts = form.elements
          .map((e, i) => {
            const ni = i + 1;
            return (
              '<option value="' +
              ni +
              '"' +
              (ni === n ? " selected" : "") +
              ">/" +
              ni +
              " " +
              escapeHtml(e) +
              "</option>"
            );
          })
          .join("");
        return (
          '<div class="lg-place-row" data-idx="' +
          idx +
          '">' +
          '<select class="pl-n">' +
          (opts || nOpts) +
          "</select>" +
          '<input class="pl-x" type="text" value="' +
          escapeHtml(p.x) +
          '" title="X" />' +
          '<input class="pl-y" type="text" value="' +
          escapeHtml(p.y) +
          '" title="Y" />' +
          '<input class="pl-z" type="text" value="' +
          escapeHtml(p.z) +
          '" title="Z" />' +
          '<button type="button" class="lg-btn secondary pl-del" data-del="' +
          idx +
          '">×</button>' +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="lg-places">' +
      '<div class="lg-place-head"><span>/n прототип</span><span>X</span><span>Y</span><span>Z</span><span></span></div>' +
      rows +
      "</div>" +
      '<button type="button" class="lg-btn secondary" id="btnAddPlace">+ экземпляр</button>'
    );
  }

  function footprintShapes(name) {
    const fp = (form.footprints || []).find((f) => f.name === name);
    return fp && fp.shapes ? fp.shapes : [];
  }

  function localBBox(name) {
    const shapes = footprintShapes(name);
    if (!shapes.length) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    shapes.forEach((sh) => {
      if (sh.kind === "rect") {
        minX = Math.min(minX, sh.x1, sh.x2);
        maxX = Math.max(maxX, sh.x1, sh.x2);
        minY = Math.min(minY, sh.y1, sh.y2);
        maxY = Math.max(maxY, sh.y1, sh.y2);
      } else if (sh.kind === "circle") {
        minX = Math.min(minX, sh.x - sh.r);
        maxX = Math.max(maxX, sh.x + sh.r);
        minY = Math.min(minY, sh.y - sh.r);
        maxY = Math.max(maxY, sh.y + sh.r);
      } else if (sh.kind === "poly") {
        (sh.points || []).forEach((q) => {
          minX = Math.min(minX, q.x);
          maxX = Math.max(maxX, q.x);
          minY = Math.min(minY, q.y);
          maxY = Math.max(maxY, q.y);
        });
      }
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY, shapes };
  }

  let plotView = null;
  let snapEnabled = true;
  let dragState = null;

  function fmtNum(n) {
    if (!Number.isFinite(n)) return "0";
    if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
    const r = Math.round(n * 1000) / 1000;
    return String(r);
  }

  function parseCoord(v) {
    const n = parseFloat(String(v ?? "0").replace(/,/g, "."));
    return Number.isFinite(n) ? n : 0;
  }

  function protoExtent(elementName, pitch) {
    const bb = localBBox(elementName);
    if (bb) return bb;
    const h = Math.max(1, (pitch || 20) * 0.35);
    return { minX: -h, maxX: h, minY: -h, maxY: h, shapes: [] };
  }

  function worldAabb(p, pitch) {
    const el = form.elements[(p.protoIndex || 1) - 1] || p.element;
    const ext = protoExtent(el, pitch);
    const x = parseCoord(p.x);
    const y = parseCoord(p.y);
    return {
      minX: x + ext.minX,
      maxX: x + ext.maxX,
      minY: y + ext.minY,
      maxY: y + ext.maxY,
      w: ext.maxX - ext.minX,
      h: ext.maxY - ext.minY,
      ext: ext,
    };
  }

  function estimatePitch() {
    const xs = [];
    const ys = [];
    for (const p of form.placements || []) {
      xs.push(parseCoord(p.x));
      ys.push(parseCoord(p.y));
    }
    const uniq = (a) => Array.from(new Set(a)).sort((u, v) => u - v);
    const ux = uniq(xs);
    const uy = uniq(ys);
    const dx = ux.length > 1 ? ux[1] - ux[0] : 0;
    const dy = uy.length > 1 ? uy[1] - uy[0] : 0;
    return Math.max(dx, dy, 1);
  }

  function rangesOverlap(a0, a1, b0, b1, pad) {
    const loA = Math.min(a0, a1) - pad;
    const hiA = Math.max(a0, a1) + pad;
    const loB = Math.min(b0, b1);
    const hiB = Math.max(b0, b1);
    return loA <= hiB && loB <= hiA;
  }

  /** Рёбра контура в локальных координатах прототипа. */
  function localEdges(shapes, fallbackExtent) {
    const edges = [];
    const pushClosed = (pts) => {
      if (!pts || pts.length < 2) return;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    };
    (shapes || []).forEach((sh) => {
      if (sh.kind === "rect") {
        const x1 = Math.min(sh.x1, sh.x2);
        const x2 = Math.max(sh.x1, sh.x2);
        const y1 = Math.min(sh.y1, sh.y2);
        const y2 = Math.max(sh.y1, sh.y2);
        pushClosed([
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ]);
      } else if (sh.kind === "poly" && sh.points && sh.points.length >= 3) {
        pushClosed(sh.points);
      }
    });
    if (!edges.length && fallbackExtent) {
      const e = fallbackExtent;
      pushClosed([
        { x: e.minX, y: e.minY },
        { x: e.maxX, y: e.minY },
        { x: e.maxX, y: e.maxY },
        { x: e.minX, y: e.maxY },
      ]);
    }
    return edges;
  }

  function localCircles(shapes) {
    return (shapes || [])
      .filter((sh) => sh.kind === "circle")
      .map((sh) => ({ x: sh.x, y: sh.y, r: Math.abs(sh.r) }));
  }

  /** Углы контура (вершины) в локальных координатах. */
  function localVertices(shapes, fallbackExtent) {
    const pts = [];
    const seen = new Set();
    const add = (px, py) => {
      const k = px.toFixed(6) + "," + py.toFixed(6);
      if (seen.has(k)) return;
      seen.add(k);
      pts.push({ x: px, y: py });
    };
    localEdges(shapes, fallbackExtent).forEach((e) => {
      add(e.ax, e.ay);
      add(e.bx, e.by);
    });
    return pts;
  }

  /**
   * Прилипание сразу к нескольким соседям: собираем ограничения
   * (рёбра / AABB / углы / окружности) и решаем их вместе (WLS).
   * Alt / snapEnabled=false — без snap.
   */
  function snapPlacement(idx, x, y, forceNoSnap) {
    const pitch = estimatePitch();
    const tol = Math.max(pitch * 0.12, 0.75);
    const p = form.placements[idx];
    if (!p) return { x: x, y: y, snapped: false };
    if (forceNoSnap || !snapEnabled) return { x: x, y: y, snapped: false };

    const elName = form.elements[(p.protoIndex || 1) - 1] || p.element;
    const ext = protoExtent(elName, pitch);
    const myEdges = localEdges(ext.shapes, ext);
    const myVerts = localVertices(ext.shapes, ext);
    const myCircles = localCircles(ext.shapes);

    /** @type {Array<{ nx: number, ny: number, b: number, w: number }>} */
    const constraints = [];

    const addConstraint = (nx, ny, b, residual) => {
      const ad = Math.abs(residual);
      if (ad > tol) return;
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) return;
      const ux = nx / len;
      const uy = ny / len;
      // ближние сильнее; ось/ребро с меньшим зазором важнее
      const w = 1 / (ad + 0.05);
      constraints.push({ nx: ux, ny: uy, b: b, w: w });
    };

    // Смещение origin (dx,dy): nx*dx + ny*dy = b
    const addAxisX = (targetX, residual) => addConstraint(1, 0, targetX - x, residual);
    const addAxisY = (targetY, residual) => addConstraint(0, 1, targetY - y, residual);
    const addNormal = (nx, ny, residual) => {
      // двигаем вдоль нормали на -residual
      addConstraint(nx, ny, -residual, residual);
    };

    const left = x + ext.minX;
    const right = x + ext.maxX;
    const bottom = y + ext.minY;
    const top = y + ext.maxY;
    const overlapPad = tol * 0.5;

    for (let j = 0; j < form.placements.length; j++) {
      if (j === idx) continue;
      const o = form.placements[j];
      const oa = worldAabb(o, pitch);
      const oEl = form.elements[(o.protoIndex || 1) - 1] || o.element;
      const oExt = protoExtent(oEl, pitch);
      const ox = parseCoord(o.x);
      const oy = parseCoord(o.y);

      // AABB — отдельные оси (угол = два соседа)
      if (rangesOverlap(bottom, top, oa.minY, oa.maxY, overlapPad)) {
        addAxisX(oa.minX - ext.maxX, Math.abs(right - oa.minX));
        addAxisX(oa.maxX - ext.minX, Math.abs(left - oa.maxX));
      }
      if (rangesOverlap(left, right, oa.minX, oa.maxX, overlapPad)) {
        addAxisY(oa.minY - ext.maxY, Math.abs(top - oa.minY));
        addAxisY(oa.maxY - ext.minY, Math.abs(bottom - oa.maxY));
      }

      // Углы → углы: обе оси сразу (усиливает карман)
      const oVerts = localVertices(oExt.shapes, oExt);
      for (let vi = 0; vi < myVerts.length; vi++) {
        const mv = myVerts[vi];
        const wx = mv.x + x;
        const wy = mv.y + y;
        for (let oi = 0; oi < oVerts.length; oi++) {
          const ov = oVerts[oi];
          const tx = ov.x + ox;
          const ty = ov.y + oy;
          const d = Math.hypot(wx - tx, wy - ty);
          if (d > tol) continue;
          const targetOx = tx - mv.x;
          const targetOy = ty - mv.y;
          addAxisX(targetOx, Math.abs(wx - tx));
          addAxisY(targetOy, Math.abs(wy - ty));
        }
      }

      // Рёбра: ограничение по нормали (квадрат / шестигранник / треугольник)
      const oEdges = localEdges(oExt.shapes, oExt);
      for (let ei = 0; ei < myEdges.length; ei++) {
        const e = myEdges[ei];
        const eax = e.ax + x;
        const eay = e.ay + y;
        const ebx = e.bx + x;
        const eby = e.by + y;
        const edx = ebx - eax;
        const edy = eby - eay;
        const eLen = Math.hypot(edx, edy);
        if (eLen < 1e-9) continue;
        const eux = edx / eLen;
        const euy = edy / eLen;

        for (let fi = 0; fi < oEdges.length; fi++) {
          const f = oEdges[fi];
          const fax = f.ax + ox;
          const fay = f.ay + oy;
          const fbx = f.bx + ox;
          const fby = f.by + oy;
          const fdx = fbx - fax;
          const fdy = fby - fay;
          const fLen = Math.hypot(fdx, fdy);
          if (fLen < 1e-9) continue;
          const fux = fdx / fLen;
          const fuy = fdy / fLen;

          const align = Math.abs(eux * fux + euy * fuy);
          if (align < 0.92) continue;

          const nx = -fuy;
          const ny = fux;
          const dist = (eax - fax) * nx + (eay - fay) * ny;

          const t0 = (eax - fax) * fux + (eay - fay) * fuy;
          const t1 = (ebx - fax) * fux + (eby - fay) * fuy;
          const eLo = Math.min(t0, t1);
          const eHi = Math.max(t0, t1);
          if (!rangesOverlap(eLo, eHi, 0, fLen, overlapPad)) continue;

          addNormal(nx, ny, dist);
        }
      }

      // Окружности — касание (радиальное ограничение)
      const oCircles = localCircles(oExt.shapes);
      for (const c of myCircles) {
        for (const d of oCircles) {
          const cx = c.x + x;
          const cy = c.y + y;
          const dx0 = d.x + ox;
          const dy0 = d.y + oy;
          const want = c.r + d.r;
          const vx = cx - dx0;
          const vy = cy - dy0;
          const dist = Math.hypot(vx, vy);
          if (dist < 1e-9) continue;
          const gap = dist - want;
          if (Math.abs(gap) > tol) continue;
          const ux = vx / dist;
          const uy = vy / dist;
          addNormal(ux, uy, gap);
        }
      }
    }

    if (!constraints.length) return { x: x, y: y, snapped: false };

    // WLS: min Σ w (nx·δ + ny·δ - b)²
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      const w = c.w;
      a11 += w * c.nx * c.nx;
      a12 += w * c.nx * c.ny;
      a22 += w * c.ny * c.ny;
      b1 += w * c.nx * c.b;
      b2 += w * c.ny * c.b;
    }

    const det = a11 * a22 - a12 * a12;
    let dx = 0;
    let dy = 0;
    if (Math.abs(det) > 1e-12) {
      dx = (a22 * b1 - a12 * b2) / det;
      dy = (a11 * b2 - a12 * b1) / det;
    } else if (a11 > 1e-12) {
      dx = b1 / a11;
    } else if (a22 > 1e-12) {
      dy = b2 / a22;
    } else {
      return { x: x, y: y, snapped: false };
    }

    // не уезжать дальше tol от курсора (защита от противоречивых соседей)
    const step = Math.hypot(dx, dy);
    if (step > tol * 2.5) {
      const s = (tol * 2.5) / step;
      dx *= s;
      dy *= s;
    }

    return { x: x + dx, y: y + dy, snapped: true };
  }

  function syncPlacementRowInputs() {
    root.querySelectorAll(".lg-place-row").forEach((row) => {
      const idx = +row.getAttribute("data-idx");
      const p = form.placements[idx];
      if (!p) return;
      const x = row.querySelector(".pl-x");
      const y = row.querySelector(".pl-y");
      const z = row.querySelector(".pl-z");
      if (x) x.value = p.x;
      if (y) y.value = p.y;
      if (z) z.value = p.z;
      const sel = row.querySelector(".pl-n");
      if (sel && p.protoIndex) sel.value = String(p.protoIndex);
    });
  }

  function renderPlotOnly() {
    const wrap = root.querySelector(".lg-grid-wrap");
    if (!wrap) return;
    wrap.innerHTML = plotHtml();
    if (!dragState) bindPlot();
    else {
      const g = wrap.querySelector('.lg-proto[data-idx="' + dragState.idx + '"]');
      if (g) g.classList.add("dragging");
      const snapEl = wrap.querySelector("#lgSnapToggle");
      if (snapEl) snapEl.checked = snapEnabled;
    }
    syncPlacementRowInputs();
  }

  function schedulePlotRefresh() {
    clearTimeout(plotTimer);
    plotTimer = setTimeout(() => {
      readFormFromDom();
      renderPlotOnly();
    }, 80);
  }

  function svgPointFromEvent(svg, ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  }

  function worldFromSvgXY(sx, sy) {
    if (!plotView) return { x: 0, y: 0 };
    const x = plotView.minX + (sx - plotView.ox) / plotView.scale;
    const y = plotView.minY + (plotView.H - plotView.oy - sy) / plotView.scale;
    return { x: x, y: y };
  }

  /** Превью в мировых координатах PARM + DnD / snap. */
  function plotHtml() {
    const pitch = estimatePitch();
    const pts = (form.placements || [])
      .map((p, idx) => {
        const x = parseCoord(p.x);
        const y = parseCoord(p.y);
        const pi = protoIndexOf(p);
        return {
          idx: idx,
          x: x,
          y: y,
          z: parseCoord(p.z),
          protoIndex: pi,
          element: form.elements[pi - 1] || p.element || "?",
        };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    const pad = 40;
    const W = 560;
    const H = 440;
    let minX;
    let maxX;
    let minY;
    let maxY;
    let scale;
    let ox;
    let oy;

    if (dragState && plotView) {
      minX = plotView.minX;
      maxX = plotView.maxX;
      minY = plotView.minY;
      maxY = plotView.maxY;
      scale = plotView.scale;
      ox = plotView.ox;
      oy = plotView.oy;
    } else {
      minX = 0;
      maxX = pitch * 2;
      minY = 0;
      maxY = pitch * 2;
      if (pts.length) {
        minX = Infinity;
        maxX = -Infinity;
        minY = Infinity;
        maxY = -Infinity;
        pts.forEach((p) => {
          const ext = protoExtent(p.element, pitch);
          minX = Math.min(minX, p.x + ext.minX);
          maxX = Math.max(maxX, p.x + ext.maxX);
          minY = Math.min(minY, p.y + ext.minY);
          maxY = Math.max(maxY, p.y + ext.maxY);
        });
        const mx = (maxX - minX) * 0.08 || pitch * 0.2;
        const my = (maxY - minY) * 0.08 || pitch * 0.2;
        minX -= mx;
        maxX += mx;
        minY -= my;
        maxY += my;
      }
      const spanX = Math.max(1e-6, maxX - minX);
      const spanY = Math.max(1e-6, maxY - minY);
      scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
      ox = pad + ((W - 2 * pad) - spanX * scale) / 2;
      oy = pad + ((H - 2 * pad) - spanY * scale) / 2;
    }

    const sx = (x) => ox + (x - minX) * scale;
    const sy = (y) => H - oy - (y - minY) * scale;

    plotView = {
      W: W,
      H: H,
      pad: pad,
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY,
      scale: scale,
      ox: ox,
      oy: oy,
      pitch: pitch,
    };

    const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);
    const xs = uniq(pts.map((p) => p.x));
    const ys = uniq(pts.map((p) => p.y));

    const palette =
      form.elements.length > 0
        ? form.elements.map((e, i) => chipHtml(e, i + 1)).join("")
        : '<span class="lg-hint">Добавьте прототип в LISTEL слева</span>';

    let bodies = "";
    const axisY0 = sy(Math.min(Math.max(0, minY), maxY));
    const axisX0 = sx(Math.min(Math.max(0, minX), maxX));
    bodies +=
      '<line x1="' +
      pad +
      '" y1="' +
      axisY0.toFixed(1) +
      '" x2="' +
      (W - pad) +
      '" y2="' +
      axisY0.toFixed(1) +
      '" class="lg-plot-axis"/>';
    bodies +=
      '<line x1="' +
      axisX0.toFixed(1) +
      '" y1="' +
      pad +
      '" x2="' +
      axisX0.toFixed(1) +
      '" y2="' +
      (H - pad) +
      '" class="lg-plot-axis"/>';

    // подписи осей — не чаще чем раз в ~36px (иначе каша после DnD)
    const thinAxis = (vals, toPx) => {
      const out = [];
      let lastPx = -1e9;
      for (const v of vals) {
        const px = toPx(v);
        if (out.length && Math.abs(px - lastPx) < 36) continue;
        out.push(v);
        lastPx = px;
      }
      return out;
    };
    thinAxis(xs, sx).forEach((xv) => {
      bodies +=
        '<text x="' +
        sx(xv).toFixed(1) +
        '" y="' +
        (H - 12) +
        '" text-anchor="middle" class="lg-plot-lbl">' +
        fmtNum(xv) +
        "</text>";
    });
    thinAxis(ys, sy).forEach((yv) => {
      bodies +=
        '<text x="14" y="' +
        (sy(yv) + 3).toFixed(1) +
        '" text-anchor="middle" class="lg-plot-lbl">' +
        fmtNum(yv) +
        "</text>";
    });

    const shapeArea = (sh) => {
      if (sh.kind === "rect") {
        return Math.abs((sh.x2 - sh.x1) * (sh.y2 - sh.y1));
      }
      if (sh.kind === "circle") return Math.PI * sh.r * sh.r;
      if (sh.kind === "poly" && sh.points && sh.points.length >= 3) {
        let a = 0;
        const poly = sh.points;
        for (let i = 0; i < poly.length; i++) {
          const q = poly[i];
          const r = poly[(i + 1) % poly.length];
          a += q.x * r.y - r.x * q.y;
        }
        return Math.abs(a) * 0.5;
      }
      return 0;
    };

    pts.forEach((p) => {
      const col = colorFor(p.element);
      const ext = protoExtent(p.element, pitch);
      const ox1 = sx(p.x + ext.minX);
      const oy1 = sy(p.y + ext.minY);
      const ox2 = sx(p.x + ext.maxX);
      const oy2 = sy(p.y + ext.maxY);
      const left = Math.min(ox1, ox2);
      const top = Math.min(oy1, oy2);
      const rw = Math.abs(ox2 - ox1);
      const rh = Math.abs(oy2 - oy1);
      const labelX = left + rw / 2;
      const labelY = top + Math.min(14, Math.max(10, rh * 0.18));

      const drawShape = (sh, fillA, strokeW, cls) => {
        if (sh.kind === "rect") {
          const x1 = sx(p.x + sh.x1);
          const y1 = sy(p.y + sh.y1);
          const x2 = sx(p.x + sh.x2);
          const y2 = sy(p.y + sh.y2);
          return (
            '<rect class="' +
            cls +
            '" x="' +
            Math.min(x1, x2).toFixed(1) +
            '" y="' +
            Math.min(y1, y2).toFixed(1) +
            '" width="' +
            Math.abs(x2 - x1).toFixed(1) +
            '" height="' +
            Math.abs(y2 - y1).toFixed(1) +
            '" fill="' +
            col +
            fillA +
            '" stroke="' +
            col +
            '" stroke-width="' +
            strokeW +
            '" pointer-events="none"/>'
          );
        }
        if (sh.kind === "circle") {
          return (
            '<circle class="' +
            cls +
            '" cx="' +
            sx(p.x + sh.x).toFixed(1) +
            '" cy="' +
            sy(p.y + sh.y).toFixed(1) +
            '" r="' +
            Math.abs(sh.r * scale).toFixed(1) +
            '" fill="' +
            col +
            fillA +
            '" stroke="' +
            col +
            '" stroke-width="' +
            strokeW +
            '" pointer-events="none"/>'
          );
        }
        if (sh.kind === "poly" && sh.points) {
          return (
            '<polygon class="' +
            cls +
            '" points="' +
            sh.points
              .map((q) => sx(p.x + q.x).toFixed(1) + "," + sy(p.y + q.y).toFixed(1))
              .join(" ") +
            '" fill="' +
            col +
            fillA +
            '" stroke="' +
            col +
            '" stroke-width="' +
            strokeW +
            '" pointer-events="none"/>'
          );
        }
        return "";
      };

      bodies += '<g class="lg-proto" data-idx="' + p.idx + '">';

      const shapes = (ext.shapes || []).slice().sort((a, b) => shapeArea(b) - shapeArea(a));
      if (shapes.length) {
        // внешний контур = самая крупная фигура (HEX/RPP), без AABB-коробки
        bodies += drawShape(shapes[0], "33", 2.2, "lg-proto-shell");
        for (let si = 1; si < shapes.length; si++) {
          bodies += drawShape(shapes[si], "44", 1, "lg-proto-inner");
        }
      } else {
        bodies +=
          '<rect class="lg-proto-shell" x="' +
          left.toFixed(1) +
          '" y="' +
          top.toFixed(1) +
          '" width="' +
          rw.toFixed(1) +
          '" height="' +
          rh.toFixed(1) +
          '" fill="' +
          col +
          '55" stroke="' +
          col +
          '" stroke-width="1.4" stroke-dasharray="4 3"/>';
      }

      const cx = sx(p.x);
      const cy = sy(p.y);
      bodies +=
        '<line x1="' +
        (cx - 4).toFixed(1) +
        '" y1="' +
        cy.toFixed(1) +
        '" x2="' +
        (cx + 4).toFixed(1) +
        '" y2="' +
        cy.toFixed(1) +
        '" stroke="#111" stroke-width="1" pointer-events="none"/>' +
        '<line x1="' +
        cx.toFixed(1) +
        '" y1="' +
        (cy - 4).toFixed(1) +
        '" x2="' +
        cx.toFixed(1) +
        '" y2="' +
        (cy + 4).toFixed(1) +
        '" stroke="#111" stroke-width="1" pointer-events="none"/>';

      bodies +=
        '<text x="' +
        labelX.toFixed(1) +
        '" y="' +
        labelY.toFixed(1) +
        '" text-anchor="middle" dominant-baseline="hanging" class="lg-proto-lbl">/' +
        p.protoIndex +
        " " +
        escapeHtml(p.element) +
        "</text>";

      bodies +=
        '<rect class="lg-proto-hit" x="' +
        left.toFixed(1) +
        '" y="' +
        top.toFixed(1) +
        '" width="' +
        Math.max(rw, 12).toFixed(1) +
        '" height="' +
        Math.max(rh, 12).toFixed(1) +
        '" fill="transparent"/>';
      bodies += "</g>";
    });

    const snapChk = snapEnabled ? " checked" : "";
    return (
      '<div class="lg-plot">' +
      '<div class="lg-plot-palette" title="Перетащите прототип на поле">' +
      '<div class="lg-plot-palette-chips">' +
      palette +
      "</div>" +
      '<label class="lg-snap-toggle" title="Alt во время перетаскивания — временно отключить"><input type="checkbox" id="lgSnapToggle"' +
      snapChk +
      "/> прилипание</label>" +
      "</div>" +
      '<svg class="lg-plot-svg" viewBox="0 0 ' +
      W +
      " " +
      H +
      '" preserveAspectRatio="xMidYMid meet">' +
      '<rect class="lg-plot-drop" x="0" y="0" width="' +
      W +
      '" height="' +
      H +
      '" fill="transparent"/>' +
      bodies +
      (pts.length
        ? ""
        : '<text x="' +
          W / 2 +
          '" y="' +
          H / 2 +
          '" text-anchor="middle" class="lg-plot-lbl">Перетащите прототип сюда</text>') +
      "</svg></div>"
    );
  }

  function bindPlot() {
    const svg = root.querySelector(".lg-plot-svg");
    if (!svg) return;

    const snapEl = root.querySelector("#lgSnapToggle");
    if (snapEl) {
      snapEl.checked = snapEnabled;
      snapEl.onchange = () => {
        snapEnabled = Boolean(snapEl.checked);
      };
    }

    root.querySelectorAll(".lg-chip[data-drag-proto]").forEach((chip) => {
      chip.ondragstart = (ev) => {
        const name = chip.getAttribute("data-drag-proto");
        const idx = chip.getAttribute("data-drag-idx");
        ev.dataTransfer.setData("text/lg-proto", name + "\t" + idx);
        ev.dataTransfer.effectAllowed = "copy";
      };
    });

    root.querySelectorAll(".lg-plot-palette [data-remove]").forEach((el) => {
      el.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeElement(el.getAttribute("data-remove"));
      };
    });

    svg.ondragover = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      svg.classList.add("lg-plot-dragover");
    };
    svg.ondragleave = () => svg.classList.remove("lg-plot-dragover");
    svg.ondrop = (ev) => {
      ev.preventDefault();
      svg.classList.remove("lg-plot-dragover");
      const raw = ev.dataTransfer.getData("text/lg-proto");
      if (!raw) return;
      const parts = raw.split("\t");
      const name = parts[0];
      const pi = Math.max(1, parseInt(parts[1] || "1", 10) || 1);
      const loc = svgPointFromEvent(svg, ev);
      const w = worldFromSvgXY(loc.x, loc.y);
      form.placements = form.placements || [];
      const newIdx = form.placements.length;
      form.placements.push({
        element: name,
        protoIndex: pi,
        x: fmtNum(w.x),
        y: fmtNum(w.y),
        z: "0",
      });
      const snapped = snapPlacement(newIdx, w.x, w.y, ev.altKey);
      form.placements[newIdx].x = fmtNum(snapped.x);
      form.placements[newIdx].y = fmtNum(snapped.y);
      render();
      schedulePush();
    };

    svg.querySelectorAll(".lg-proto").forEach((g) => {
      g.onpointerdown = (ev) => {
        if (ev.button !== 0) return;
        const idx = +g.getAttribute("data-idx");
        if (!Number.isFinite(idx) || !form.placements[idx]) return;
        ev.preventDefault();
        const loc = svgPointFromEvent(svg, ev);
        const w = worldFromSvgXY(loc.x, loc.y);
        const p = form.placements[idx];
        dragState = {
          idx: idx,
          grabDx: w.x - parseCoord(p.x),
          grabDy: w.y - parseCoord(p.y),
        };
        g.classList.add("dragging");
        svg.classList.add("lg-plot-dragging");
      };
    });

    if (!window.__lgPlotDragBound) {
      window.__lgPlotDragBound = true;
      window.addEventListener("pointermove", (ev) => {
        if (!dragState) return;
        const svgLive = root.querySelector(".lg-plot-svg");
        if (!svgLive) return;
        const loc = svgPointFromEvent(svgLive, ev);
        const w = worldFromSvgXY(loc.x, loc.y);
        const nx = w.x - dragState.grabDx;
        const ny = w.y - dragState.grabDy;
        const snapped = snapPlacement(dragState.idx, nx, ny, ev.altKey);
        const p = form.placements[dragState.idx];
        if (!p) return;
        p.x = fmtNum(snapped.x);
        p.y = fmtNum(snapped.y);
        renderPlotOnly();
        const g = root.querySelector('.lg-proto[data-idx="' + dragState.idx + '"]');
        if (g) {
          g.classList.add("dragging");
          if (snapped.snapped) g.classList.add("snapped");
        }
      });
      window.addEventListener("pointerup", () => {
        if (!dragState) return;
        dragState = null;
        const svgLive = root.querySelector(".lg-plot-svg");
        if (svgLive) svgLive.classList.remove("lg-plot-dragging");
        renderPlotOnly();
        schedulePush();
      });
    }
  }

  function render() {
    if (!form) {
      root.innerHTML = '<p style="padding:16px;color:var(--lg-muted)">Загрузка…</p>';
      return;
    }

    const zoneOpts = context.zoneNames
      .map((z) => '<option value="' + escapeHtml(z) + '"></option>')
      .join("");
    const suggest = context.lcellNames.filter((n) => !form.elements.includes(n));
    const canReplace = Boolean(context.canReplace || preview.canReplace);

    root.innerHTML =
      '<header class="lg-header">' +
      "<div>" +
      "<h1>Решётка GLTL</h1>" +
      '<p class="lg-sub">§9.2.6.1 · курсор на LATT GLTL → «Из контекста»</p>' +
      (context.boundLabel
        ? '<p class="lg-bound">Привязка: ' + escapeHtml(context.boundLabel) + "</p>"
        : '<p class="lg-bound lg-bound-warn">Нет привязки к файлу — нажмите «Из контекста»</p>') +
      "</div>" +
      '<div class="lg-doc">' +
      escapeHtml(context.docLabel || "нет .mcu") +
      "</div>" +
      "</header>" +
      '<div class="lg-layout">' +
      '<aside class="lg-form">' +
      "<fieldset><legend>Зона-носитель</legend>" +
      '<div class="lg-row"><label for="zoneName">Зона</label>' +
      '<input id="zoneName" list="zoneList" type="text" value="' +
      escapeHtml(form.zoneName) +
      '" />' +
      '<datalist id="zoneList">' +
      zoneOpts +
      "</datalist></div></fieldset>" +
      "<fieldset><legend>LISTEL — прототипы</legend>" +
      '<p class="lg-hint">Порядок = номер /n. Перетаскивание — из панели над графикой.</p>' +
      '<div class="lg-add-row">' +
      '<input id="newEl" type="text" placeholder="имя LCELL" maxlength="6" />' +
      '<button type="button" class="lg-btn secondary" id="btnAddEl">+</button>' +
      '<button type="button" class="lg-btn secondary" id="btnStubEl" title="Вставить заготовку LCELL">LCELL</button>' +
      "</div>" +
      (form.elements.length
        ? '<p class="lg-listel-names">' +
          form.elements
            .map((e, i) => "<code>/" + (i + 1) + " " + escapeHtml(e) + "</code>")
            .join(" · ") +
          "</p>"
        : "") +
      (suggest.length
        ? '<p class="lg-hint">Из документа: ' +
          suggest
            .slice(0, 12)
            .map(
              (n) =>
                '<button type="button" data-suggest="' +
                escapeHtml(n) +
                '">' +
                escapeHtml(n) +
                "</button>"
            )
            .join(" ") +
          "</p>"
        : "") +
      "</fieldset>" +
      "<fieldset><legend>PARM — сдвиги</legend>" +
      '<p class="lg-hint">[/n] действует только на следующий вектор (X,Y,Z).</p>' +
      placementsHtml() +
      "</fieldset>" +
      "<fieldset><legend>Опции</legend>" +
      '<div class="lg-row"><label for="lfixso">LFIXSO</label>' +
      '<input id="lfixso" type="text" value="' +
      escapeHtml(form.lfixso || "") +
      '" placeholder="2,1" /></div>' +
      '<div class="lg-row"><label for="lblack">LBLACK</label>' +
      '<input id="lblack" type="text" value="' +
      escapeHtml(form.lblack || "") +
      '" placeholder="0,1" /></div>' +
      "</fieldset>" +
      '<div class="lg-actions">' +
      '<button type="button" class="lg-btn primary" id="btnFromCtx" title="Взять LISTEL и PARM из LATT под курсором в редакторе">Из контекста</button>' +
      '<button type="button" class="lg-btn secondary" id="btnClearCtx">Сбросить привязку</button>' +
      '<button type="button" class="lg-btn" id="btnInsert">Вставить</button>' +
      '<button type="button" class="lg-btn" id="btnReplace"' +
      (canReplace ? "" : " disabled") +
      ">Заменить</button>" +
      "</div>" +
      '<p class="lg-hint">Контекст: клик по LATT в сайдбаре «Решётки» (курсор на блоке) → эта кнопка, либо откройте конструктор с вкладки Решётки.</p>' +
      "</aside>" +
      '<main class="lg-main">' +
      '<div class="lg-grid-wrap lg-gltl-pad">' +
      plotHtml() +
      "</div>" +
      '<section class="lg-preview">' +
      "<h2>MCU текст</h2>" +
      (preview.warnings && preview.warnings.length
        ? '<ul class="lg-warn">' +
          preview.warnings.map((w) => "<li>" + escapeHtml(w) + "</li>").join("") +
          "</ul>"
        : "") +
      '<pre class="lg-code">' +
      escapeHtml(preview.text || "") +
      "</pre>" +
      "</section>" +
      "</main>" +
      "</div>";

    bind();
  }

  function bind() {
    bindPlot();
    ["zoneName", "lfixso", "lblack"].forEach((id) => {
      root.querySelector("#" + id)?.addEventListener("change", onChange);
      root.querySelector("#" + id)?.addEventListener("input", onChange);
    });
    root.querySelectorAll(".pl-n, .pl-x, .pl-y, .pl-z").forEach((el) => {
      el.addEventListener("change", onChange);
      el.addEventListener("input", onChange);
    });
    root.querySelector("#btnAddPlace")?.addEventListener("click", () => {
      form.placements = form.placements || [];
      form.placements.push({
        element: form.elements[0] || "",
        protoIndex: 1,
        x: "0",
        y: "0",
        z: "0",
      });
      render();
      schedulePush();
    });
    root.querySelectorAll(".pl-del").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = +el.getAttribute("data-del");
        form.placements.splice(idx, 1);
        render();
        schedulePush();
      });
    });
    root.querySelector("#btnAddEl")?.addEventListener("click", () => {
      addElement(root.querySelector("#newEl")?.value);
    });
    root.querySelector("#newEl")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addElement(e.target.value);
    });
    root.querySelector("#btnStubEl")?.addEventListener("click", () => {
      const name = root.querySelector("#newEl")?.value?.trim();
      if (!name) return;
      addElement(name);
      vscode.postMessage({ type: "insertLcell", name: name });
    });
    root.querySelectorAll("[data-suggest]").forEach((el) => {
      el.addEventListener("click", () => addElement(el.getAttribute("data-suggest")));
    });
    root.querySelectorAll("[data-remove]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        removeElement(el.getAttribute("data-remove"));
      });
    });
    root.querySelector("#btnFromCtx")?.addEventListener("click", () => {
      vscode.postMessage({ type: "fromContext" });
    });
    root.querySelector("#btnClearCtx")?.addEventListener("click", () => {
      vscode.postMessage({ type: "clearContext" });
    });
    root.querySelector("#btnInsert")?.addEventListener("click", () => {
      readFormFromDom();
      vscode.postMessage({ type: "setForm", form: form });
      vscode.postMessage({ type: "insert" });
    });
    root.querySelector("#btnReplace")?.addEventListener("click", () => {
      readFormFromDom();
      vscode.postMessage({ type: "setForm", form: form });
      vscode.postMessage({ type: "replace" });
    });
  }

  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;
    if (msg.type === "form") {
      form = msg.form;
      form.latticeType = "GLTL";
      render();
    } else if (msg.type === "context") {
      context = {
        lcellNames: msg.lcellNames || [],
        zoneNames: msg.zoneNames || [],
        docLabel: msg.docLabel || "",
        canReplace: Boolean(msg.canReplace),
        boundLabel: msg.boundLabel || "",
      };
      render();
    } else if (msg.type === "preview") {
      preview = {
        text: msg.text || "",
        warnings: msg.warnings || [],
        okToInsert: Boolean(msg.okToInsert),
        canReplace: Boolean(msg.canReplace),
      };
      const pre = root.querySelector(".lg-code");
      const warn = root.querySelector(".lg-warn");
      if (pre) pre.textContent = preview.text;
      if (warn || preview.warnings.length) render();
      else {
        const btn = root.querySelector("#btnReplace");
        if (btn) btn.disabled = !preview.canReplace && !context.canReplace;
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
