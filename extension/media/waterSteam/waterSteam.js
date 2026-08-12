/* Webview: ρ–T chart + dens H/O; P = Psat (расчёты IF97 на host). */
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    docLabel: document.getElementById("docLabel"),
    note: document.getElementById("note"),
    footnote: document.getElementById("footnote"),
    chart: document.getElementById("chart"),
    hoverReadout: document.getElementById("hoverReadout"),
    inpT: document.getElementById("inpT"),
    inpP: document.getElementById("inpP"),
    selPUnit: document.getElementById("selPUnit"),
    inpRho: document.getElementById("inpRho"),
    outNH: document.getElementById("outNH"),
    outNO: document.getElementById("outNO"),
    outPhase: document.getElementById("outPhase"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnInsert: document.getElementById("btnInsert"),
    err: document.getElementById("err"),
  };

  /** @type {{ T: number, P: number, rhoF: number, rhoG: number }[]} */
  let satCurve = [];
  /** @type {{ T: number, P: number, rho: number, nH: number, nO: number, phase?: string, quality?: number|null } | null} */
  let state = null;
  let canInsert = false;
  let dragging = false;
  let applying = false;
  let pressureUnit = "atm";
  /** @type {{ id: string, label: string }[]} */
  let pressureUnits = [];
  let solveTimer = null;
  /** @type {SVGGElement | null} */
  let hoverLayer = null;
  let pointerOverChart = false;
  let lastHover = null;
  /** @type {'T'|'P'|'rho'} */
  let dependent = "P";

  const fieldT = document.getElementById("fieldT");
  const fieldP = document.getElementById("fieldP");
  const fieldRho = document.getElementById("fieldRho");
  const depT = document.getElementById("depT");
  const depP = document.getElementById("depP");
  const depRho = document.getElementById("depRho");

  const pad = { l: 56, r: 18, t: 18, b: 42 };
  const W = 640;
  const H = 420;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const tMin = 274;
  const tMax = 646;
  const rhoMin = 0.0001;
  const rhoMax = 1.05;

  const TO_MPA = {
    Pa: 1e-6,
    kPa: 1e-3,
    MPa: 1,
    atm: 0.101325,
    bar: 0.1,
  };

  const NS = "http://www.w3.org/2000/svg";

  function phaseRu(s) {
    if (!s) return "—";
    if (s.quality != null && s.quality > 1e-6 && s.quality < 1 - 1e-6) return "двухфазная";
    if (s.phase === "liquid") return "жидкость";
    if (s.phase === "vapor") return "пар";
    return "—";
  }

  function fmtDens(n) {
    if (!(n > 0) || !Number.isFinite(n)) return "—";
    if (n >= 0.01 && n < 100) {
      const s = n.toPrecision(6).replace(/\.?0+$/, "");
      return s.endsWith(".") ? s.slice(0, -1) : s;
    }
    return n.toExponential(5).replace(/e\+?(-?)0*(\d+)/i, function (_m, sign, d) {
      return "E" + sign + d;
    });
  }

  function fmtRho(r) {
    if (!(r > 0) || !Number.isFinite(r)) return "";
    return String(Number(r.toPrecision(6)));
  }

  function fmtRhoHover(r) {
    if (!(r > 0) || !Number.isFinite(r)) return "—";
    if (r >= 0.1) return r.toFixed(4);
    if (r >= 0.01) return r.toFixed(5);
    return r.toExponential(3);
  }

  function pFromMPa(pMPa) {
    const f = TO_MPA[pressureUnit] || 1;
    return pMPa / f;
  }

  function pToMPa(display) {
    const f = TO_MPA[pressureUnit] || 1;
    return display * f;
  }

  function fmtPDisplay(pMPa) {
    const v = pFromMPa(pMPa);
    if (!(v > 0) || !Number.isFinite(v)) return "";
    if (pressureUnit === "Pa") return String(Math.round(v));
    return String(Number(v.toPrecision(6)));
  }

  function TtoX(T) {
    return pad.l + ((T - tMin) / (tMax - tMin)) * plotW;
  }

  function rhoToY(rho) {
    const r = Math.min(rhoMax, Math.max(rhoMin, rho));
    const t = (Math.log10(r) - Math.log10(rhoMin)) / (Math.log10(rhoMax) - Math.log10(rhoMin));
    return pad.t + (1 - t) * plotH;
  }

  function XtoT(x) {
    const t = (x - pad.l) / plotW;
    return tMin + Math.min(1, Math.max(0, t)) * (tMax - tMin);
  }

  function YtoRho(y) {
    const t = 1 - (y - pad.t) / plotH;
    const clamped = Math.min(1, Math.max(0, t));
    return Math.pow(10, Math.log10(rhoMin) + clamped * (Math.log10(rhoMax) - Math.log10(rhoMin)));
  }

  function showErr(msg) {
    if (!msg) {
      el.err.hidden = true;
      el.err.textContent = "";
      return;
    }
    el.err.hidden = false;
    el.err.textContent = msg;
  }

  function fillPressureUnits(list, selected) {
    if (!el.selPUnit) return;
    pressureUnits = list && list.length ? list : [
      { id: "atm", label: "атм" },
      { id: "Pa", label: "Па" },
      { id: "kPa", label: "кПа" },
      { id: "MPa", label: "МПа" },
      { id: "bar", label: "бар" },
    ];
    pressureUnit = selected || "atm";
    el.selPUnit.innerHTML = "";
    pressureUnits.forEach(function (u) {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.label;
      if (u.id === pressureUnit) opt.selected = true;
      el.selPUnit.appendChild(opt);
    });
  }

  function applyState(s) {
    state = s;
    applying = true;
    el.inpT.value = String(Number(s.T.toFixed(3)));
    el.inpP.value = fmtPDisplay(s.P);
    el.inpRho.value = fmtRho(s.rho);
    el.outNH.value = fmtDens(s.nH);
    el.outNO.value = fmtDens(s.nO);
    el.outPhase.value = phaseRu(s);
    applying = false;
    syncDependentUi();
    draw();
    showErr(s.warning || "");
    if (!pointerOverChart) showPointReadout();
  }

  function syncDependentUi() {
    el.inpT.readOnly = dependent === "T";
    el.inpP.readOnly = dependent === "P";
    el.inpRho.readOnly = dependent === "rho";
    if (fieldT) fieldT.classList.toggle("is-dependent", dependent === "T");
    if (fieldP) fieldP.classList.toggle("is-dependent", dependent === "P");
    if (fieldRho) fieldRho.classList.toggle("is-dependent", dependent === "rho");
    if (depT) depT.checked = dependent === "T";
    if (depP) depP.checked = dependent === "P";
    if (depRho) depRho.checked = dependent === "rho";
  }

  function setDependent(next, opts) {
    dependent = next;
    syncDependentUi();
    if (!opts || !opts.skipSolve) requestSolveFromInputs();
  }

  function scheduleSolve(mode, payload) {
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(function () {
      solveTimer = null;
      showErr("");
      if (mode === "trho") {
        vscode.postMessage({ type: "solveTRho", T: payload.T, rho: payload.rho });
      } else if (mode === "pt") {
        vscode.postMessage({ type: "solvePT", T: payload.T, P: payload.P });
      } else if (mode === "prho") {
        vscode.postMessage({ type: "solvePRho", P: payload.P, rho: payload.rho });
      }
    }, dragging ? 0 : 80);
  }

  function requestSolveFromInputs() {
    const T = Number(el.inpT.value);
    const rho = Number(el.inpRho.value);
    const Pdisp = Number(el.inpP.value);
    if (dependent === "P") {
      if (!Number.isFinite(T) || !Number.isFinite(rho) || T <= 0 || rho <= 0) {
        showErr("Для расчёта P нужны корректные T и ρ.");
        return;
      }
      scheduleSolve("trho", { T: T, rho: rho });
      return;
    }
    if (dependent === "rho") {
      if (!Number.isFinite(T) || !Number.isFinite(Pdisp) || T <= 0 || Pdisp <= 0) {
        showErr("Для расчёта ρ нужны корректные T и P.");
        return;
      }
      scheduleSolve("pt", { T: T, P: pToMPa(Pdisp) });
      return;
    }
    // dependent === "T"
    if (!Number.isFinite(Pdisp) || !Number.isFinite(rho) || Pdisp <= 0 || rho <= 0) {
      showErr("Для расчёта T нужны корректные P и ρ.");
      return;
    }
    scheduleSolve("prho", { P: pToMPa(Pdisp), rho: rho });
  }

  function requestFromChart(T, rho) {
    // График всегда задаёт T и ρ → считаем P.
    if (dependent !== "P") setDependent("P", { skipSolve: true });
    if (!Number.isFinite(T) || !Number.isFinite(rho) || T <= 0 || rho <= 0) return;
    scheduleSolve("trho", { T: T, rho: rho });
  }

  function svgNode(name, attrs) {
    const n = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        n.setAttribute(k, attrs[k]);
      });
    }
    return n;
  }

  function curvePoints(getRho) {
    const pts = [];
    for (let i = 0; i < satCurve.length; i++) {
      const pt = satCurve[i];
      pts.push({ x: TtoX(pt.T), y: rhoToY(getRho(pt)), T: pt.T, rho: getRho(pt) });
    }
    return pts;
  }

  function polyPath(pts) {
    if (!pts.length) return "";
    let d = "M" + pts[0].x.toFixed(2) + "," + pts[0].y.toFixed(2);
    for (let i = 1; i < pts.length; i++) {
      d += "L" + pts[i].x.toFixed(2) + "," + pts[i].y.toFixed(2);
    }
    return d;
  }

  function drawPhaseRegions(svg) {
    if (satCurve.length < 2) return;

    const liq = curvePoints(function (pt) {
      return pt.rhoF;
    });
    const vap = curvePoints(function (pt) {
      return pt.rhoG;
    });

    const topY = pad.t;
    const botY = pad.t + plotH;
    const leftX = pad.l;
    const rightX = pad.l + plotW;

    // Жидкость: выше ρ′ (меньший Y в SVG)
    let dLiq =
      "M" +
      leftX.toFixed(2) +
      "," +
      topY.toFixed(2) +
      "L" +
      rightX.toFixed(2) +
      "," +
      topY.toFixed(2);
    for (let i = liq.length - 1; i >= 0; i--) {
      dLiq += "L" + liq[i].x.toFixed(2) + "," + liq[i].y.toFixed(2);
    }
    dLiq += "Z";
    svg.appendChild(
      svgNode("path", {
        d: dLiq,
        fill: "color-mix(in srgb, var(--ws-liquid, #3d9a8b) 22%, transparent)",
        stroke: "none",
      })
    );

    // Двухфазная: между ρ′ и ρ″
    let dTwo = polyPath(liq);
    for (let i = vap.length - 1; i >= 0; i--) {
      dTwo += "L" + vap[i].x.toFixed(2) + "," + vap[i].y.toFixed(2);
    }
    dTwo += "Z";
    svg.appendChild(
      svgNode("path", {
        d: dTwo,
        fill: "color-mix(in srgb, var(--ws-two-phase, #c4a35a) 20%, transparent)",
        stroke: "none",
      })
    );

    // Пар: ниже ρ″
    let dVap = polyPath(vap);
    dVap +=
      "L" +
      rightX.toFixed(2) +
      "," +
      botY.toFixed(2) +
      "L" +
      leftX.toFixed(2) +
      "," +
      botY.toFixed(2) +
      "Z";
    svg.appendChild(
      svgNode("path", {
        d: dVap,
        fill: "color-mix(in srgb, var(--ws-vapor, #6b8cae) 22%, transparent)",
        stroke: "none",
      })
    );

    // Подписи областей
    function labelAt(xFrac, ySvg, text, color) {
      const t = svgNode("text", {
        x: String(pad.l + plotW * xFrac),
        y: String(ySvg),
        fill: color,
        "font-size": "11",
        "font-weight": "600",
        "text-anchor": "middle",
        opacity: "0.85",
        style: "pointer-events: none",
      });
      t.textContent = text;
      svg.appendChild(t);
    }

    const mid = satCurve[Math.floor(satCurve.length * 0.35)];
    if (mid) {
      labelAt(0.28, rhoToY(Math.min(rhoMax, mid.rhoF * 1.02)) - 10, "жидкость", "var(--ws-liquid, #3d9a8b)");
      const midRho = Math.sqrt(Math.max(mid.rhoG, rhoMin) * mid.rhoF);
      labelAt(0.45, rhoToY(midRho) + 4, "двухфазная", "var(--ws-two-phase, #c4a35a)");
      labelAt(0.62, rhoToY(Math.max(rhoMin * 1.5, mid.rhoG * 0.7)) + 12, "пар", "var(--ws-vapor, #6b8cae)");
    }
  }

  function setReadoutText(T, rho, fromCursor) {
    if (!el.hoverReadout) return;
    el.hoverReadout.classList.toggle("is-cursor", Boolean(fromCursor));
    if (!Number.isFinite(T) || !Number.isFinite(rho)) {
      el.hoverReadout.textContent = "T = —   ·   ρ = —";
      return;
    }
    el.hoverReadout.textContent =
      "T = " + T.toFixed(2) + " K   ·   ρ = " + fmtRhoHover(rho) + " г/см³";
  }

  function showPointReadout() {
    if (state) setReadoutText(state.T, state.rho, false);
    else setReadoutText(NaN, NaN, false);
  }

  function clearHoverCrosshair() {
    if (hoverLayer) {
      while (hoverLayer.firstChild) hoverLayer.removeChild(hoverLayer.firstChild);
    }
  }

  function clearHover() {
    lastHover = null;
    clearHoverCrosshair();
    showPointReadout();
  }

  function setHover(T, rho) {
    lastHover = { T: T, rho: rho };
    if (!hoverLayer) {
      setReadoutText(T, rho, true);
      return;
    }
    while (hoverLayer.firstChild) hoverLayer.removeChild(hoverLayer.firstChild);

    const x = TtoX(Math.min(tMax, Math.max(tMin, T)));
    const y = rhoToY(rho);

    hoverLayer.appendChild(
      svgNode("line", {
        x1: x,
        y1: pad.t,
        x2: x,
        y2: pad.t + plotH,
        stroke: "rgba(200,200,200,0.55)",
        "stroke-width": "1",
        "stroke-dasharray": "3 3",
        style: "pointer-events: none",
      })
    );
    hoverLayer.appendChild(
      svgNode("line", {
        x1: pad.l,
        y1: y,
        x2: pad.l + plotW,
        y2: y,
        stroke: "rgba(200,200,200,0.55)",
        "stroke-width": "1",
        "stroke-dasharray": "3 3",
        style: "pointer-events: none",
      })
    );
    hoverLayer.appendChild(
      svgNode("circle", {
        cx: x,
        cy: y,
        r: "3.5",
        fill: "var(--ws-fg, #ddd)",
        stroke: "none",
        style: "pointer-events: none",
      })
    );

    setReadoutText(T, rho, true);
  }

  function draw() {
    const svg = el.chart;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    hoverLayer = null;

    // Clip phase fills to plot area
    const defs = svgNode("defs", null);
    const clip = svgNode("clipPath", { id: "wsPlotClip" });
    clip.appendChild(
      svgNode("rect", {
        x: String(pad.l),
        y: String(pad.t),
        width: String(plotW),
        height: String(plotH),
      })
    );
    defs.appendChild(clip);
    svg.appendChild(defs);

    const regions = svgNode("g", { "clip-path": "url(#wsPlotClip)" });
    drawPhaseRegions(regions);
    svg.appendChild(regions);

    svg.appendChild(
      svgNode("rect", {
        x: String(pad.l),
        y: String(pad.t),
        width: String(plotW),
        height: String(plotH),
        fill: "transparent",
        stroke: "var(--ws-border, #444)",
        "stroke-width": "1",
      })
    );

    [0.001, 0.01, 0.1, 0.5, 1].forEach(function (r) {
      if (r < rhoMin || r > rhoMax) return;
      const y = rhoToY(r);
      svg.appendChild(
        svgNode("line", {
          x1: String(pad.l),
          y1: String(y),
          x2: String(pad.l + plotW),
          y2: String(y),
          stroke: "rgba(127,127,127,0.25)",
          "stroke-width": "1",
        })
      );
      const lab = svgNode("text", {
        x: String(pad.l - 8),
        y: String(y + 3),
        fill: "var(--ws-muted, #999)",
        "font-size": "10",
        "text-anchor": "end",
        "font-family": "var(--ws-font, monospace)",
      });
      lab.textContent = String(r);
      svg.appendChild(lab);
    });

    [300, 373, 450, 550, 640].forEach(function (T) {
      if (T < tMin || T > tMax) return;
      const x = TtoX(T);
      svg.appendChild(
        svgNode("line", {
          x1: String(x),
          y1: String(pad.t),
          x2: String(x),
          y2: String(pad.t + plotH),
          stroke: "rgba(127,127,127,0.18)",
          "stroke-width": "1",
        })
      );
      const lab = svgNode("text", {
        x: String(x),
        y: String(pad.t + plotH + 16),
        fill: "var(--ws-muted, #999)",
        "font-size": "10",
        "text-anchor": "middle",
        "font-family": "var(--ws-font, monospace)",
      });
      lab.textContent = String(T);
      svg.appendChild(lab);
    });

    const axisY = svgNode("text", {
      x: "14",
      y: String(pad.t + plotH / 2),
      fill: "var(--ws-muted, #999)",
      "font-size": "11",
      transform: "rotate(-90 14 " + (pad.t + plotH / 2) + ")",
      "text-anchor": "middle",
    });
    axisY.textContent = "ρ, г/см³ (log)";
    svg.appendChild(axisY);

    const axisX = svgNode("text", {
      x: String(pad.l + plotW / 2),
      y: String(H - 8),
      fill: "var(--ws-muted, #999)",
      "font-size": "11",
      "text-anchor": "middle",
    });
    axisX.textContent = "T, K";
    svg.appendChild(axisX);

    function strokeCurve(getRho, stroke) {
      if (satCurve.length < 2) return;
      const pts = curvePoints(getRho);
      svg.appendChild(
        svgNode("path", {
          d: polyPath(pts),
          fill: "none",
          stroke: stroke,
          "stroke-width": "2.2",
        })
      );
    }

    strokeCurve(function (pt) {
      return pt.rhoF;
    }, "var(--ws-liquid, #3d9a8b)");
    strokeCurve(function (pt) {
      return pt.rhoG;
    }, "var(--ws-vapor, #6b8cae)");

    if (state) {
      const cx = TtoX(Math.min(tMax, Math.max(tMin, state.T)));
      const cy = rhoToY(state.rho);
      svg.appendChild(
        svgNode("circle", {
          cx: String(cx),
          cy: String(cy),
          r: "7",
          fill: "var(--ws-accent, #2a7f9e)",
          stroke: "#fff",
          "stroke-width": "2",
          style: "cursor: grab",
          id: "statePoint",
        })
      );
    }

    hoverLayer = svgNode("g", { id: "hoverLayer", style: "pointer-events: none" });
    svg.appendChild(hoverLayer);

    if (pointerOverChart && lastHover) setHover(lastHover.T, lastHover.rho);
    else showPointReadout();
  }

  function svgPoint(evt) {
    const pt = el.chart.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = el.chart.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function pickFromEvent(evt) {
    const p = svgPoint(evt);
    if (!p) return null;
    if (p.x < pad.l || p.x > pad.l + plotW || p.y < pad.t || p.y > pad.t + plotH) return null;
    return { T: XtoT(p.x), rho: YtoRho(p.y) };
  }

  el.chart.addEventListener("pointerdown", function (evt) {
    const hit = pickFromEvent(evt);
    if (!hit) return;
    dragging = true;
    pointerOverChart = true;
    el.chart.setPointerCapture(evt.pointerId);
    setHover(hit.T, hit.rho);
    requestFromChart(hit.T, hit.rho);
  });

  el.chart.addEventListener("pointermove", function (evt) {
    const hit = pickFromEvent(evt);
    if (!hit) {
      if (!dragging) {
        pointerOverChart = false;
        clearHover();
      }
      return;
    }
    pointerOverChart = true;
    setHover(hit.T, hit.rho);
    if (dragging) requestFromChart(hit.T, hit.rho);
  });

  el.chart.addEventListener("pointerup", function () {
    dragging = false;
  });

  el.chart.addEventListener("pointerleave", function () {
    if (!dragging) {
      pointerOverChart = false;
      clearHover();
    }
  });
  el.chart.addEventListener("pointercancel", function () {
    dragging = false;
    pointerOverChart = false;
    clearHover();
  });

  function onIndependentInput(ev) {
    if (applying) return;
    // Зависимое поле readonly — не гоняем solve от случайных событий.
    if (ev && ev.target && ev.target.readOnly) return;
    requestSolveFromInputs();
  }

  el.inpT.addEventListener("input", onIndependentInput);
  el.inpT.addEventListener("change", onIndependentInput);
  el.inpRho.addEventListener("input", onIndependentInput);
  el.inpRho.addEventListener("change", onIndependentInput);
  el.inpP.addEventListener("input", onIndependentInput);
  el.inpP.addEventListener("change", onIndependentInput);

  function onDepChange() {
    if (depT && depT.checked) setDependent("T");
    else if (depRho && depRho.checked) setDependent("rho");
    else setDependent("P");
  }
  if (depT) depT.addEventListener("change", onDepChange);
  if (depP) depP.addEventListener("change", onDepChange);
  if (depRho) depRho.addEventListener("change", onDepChange);

  el.selPUnit.addEventListener("change", function () {
    pressureUnit = el.selPUnit.value || "atm";
    if (state) {
      applying = true;
      el.inpP.value = fmtPDisplay(state.P);
      applying = false;
    }
  });

  el.btnRefresh.addEventListener("click", function () {
    vscode.postMessage({ type: "refreshContext" });
  });

  el.btnInsert.addEventListener("click", function () {
    if (!state || !canInsert) return;
    vscode.postMessage({ type: "insert", nH: state.nH, nO: state.nO });
  });

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "init") {
      satCurve = msg.satCurve || [];
      canInsert = Boolean(msg.ctx && msg.ctx.canInsert);
      el.btnInsert.disabled = !canInsert;
      el.docLabel.textContent = (msg.ctx && msg.ctx.docLabel) || "";
      el.note.textContent = (msg.ctx && msg.ctx.note) || "";
      const foot = (msg.ctx && msg.ctx.footnote) || "";
      if (el.footnote) {
        if (foot) {
          el.footnote.hidden = false;
          el.footnote.textContent = "※ " + foot;
          el.note.style.borderBottom = "none";
          el.note.style.paddingBottom = "4px";
        } else {
          el.footnote.hidden = true;
          el.footnote.textContent = "";
          el.note.style.borderBottom = "";
          el.note.style.paddingBottom = "";
        }
      }
      fillPressureUnits(msg.pressureUnits, msg.defaultPressureUnit || "atm");
      // С графика / по умолчанию считаем давление.
      dependent = "P";
      if (msg.state) applyState(msg.state);
      else {
        showErr("");
        syncDependentUi();
        draw();
      }
      return;
    }
    if (msg.type === "state" && msg.state) {
      applyState(msg.state);
      return;
    }
    if (msg.type === "error") {
      showErr(msg.message || "Ошибка расчёта IF97");
    }
  });

  syncDependentUi();
  showPointReadout();
  vscode.postMessage({ type: "ready" });
})();
