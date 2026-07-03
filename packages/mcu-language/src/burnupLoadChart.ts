import type { BurnupLoadAnalysis, PowerPlateau } from "./burnupLoad";
import {
  collectBurnupTimeKnots,
  formatEnergyOutput,
  integrateEnergyKwd,
  powerAtTime,
} from "./burnupLoad";
import type { DocumentAst } from "./ast";
import {
  buildMaterialMassRows,
  formatMaterialMassTable,
  formatSpecificBurnupMwdPerKg,
  totalMaterialMassG,
} from "./materialVolumes";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtAxis(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toPrecision(3).replace(/\.?0+$/, "");
}

function buildPowerStepPath(
  plateaus: PowerPlateau[],
  knots: number[],
  tMax: number,
  xOf: (t: number) => number,
  yOf: (q: number) => number
): string {
  if (!knots.length) return "";

  const times = [...knots];
  if (times[times.length - 1] < tMax - 1e-9) times.push(tMax);

  const parts: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const q = powerAtTime(plateaus, i === 0 ? 0 : times[i - 1] + 1e-9);
    const x = xOf(t);
    const y = yOf(q);
    if (i === 0) {
      parts.push(`M ${x} ${y}`);
      continue;
    }
    const qPrev = powerAtTime(plateaus, times[i - 1] + 1e-9);
    parts.push(`L ${x} ${yOf(qPrev)}`);
    if (Math.abs(q - qPrev) > 1e-12) parts.push(`L ${x} ${y}`);
  }
  return parts.join(" ");
}

function buildEnergyPath(
  plateaus: PowerPlateau[],
  knots: number[],
  xOf: (t: number) => number,
  yOf: (e: number) => number
): string {
  let e = 0;
  const parts: string[] = [];
  for (let i = 0; i < knots.length; i++) {
    const t = knots[i];
    if (i > 0) {
      e += powerAtTime(plateaus, knots[i - 1] + 1e-9) * (t - knots[i - 1]);
    }
    parts.push(`${i === 0 ? "M" : "L"} ${xOf(t)} ${yOf(e)}`);
  }
  return parts.join(" ");
}

/** SVG: мощность (ступени), сетка шагов/подшагов, накопленная энерговыработка. */
export function renderBurnupLoadSvg(analysis: BurnupLoadAnalysis): string {
  const W = 520;
  const H = 300;
  const ml = 54;
  const mr = 58;
  const mt = 36;
  const mb = 44;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const tMax = analysis.totalTimeDays;
  if (tMax <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="80"><text x="12" y="40" font-size="13" fill="#64748b">Нет данных STEP/POWER</text></svg>`;
  }

  const knots = collectBurnupTimeKnots(analysis);
  let maxQ = 0;
  for (const t of knots) {
    maxQ = Math.max(maxQ, powerAtTime(analysis.powerPlateaus, Math.min(t, tMax - 1e-9)));
  }
  if (maxQ <= 0) maxQ = 1;

  const maxE = Math.max(analysis.totalEnergyKwd, 1e-9);
  const xOf = (t: number) => ml + (t / tMax) * pw;
  const yPower = (q: number) => mt + ph - (q / maxQ) * ph;
  const yEnergy = (e: number) => mt + ph - (e / maxE) * ph;
  const yBase = mt + ph;

  const stepEnds = new Set(analysis.stepPlateaus.map((s) => s.tEndDays));

  const powerLine = buildPowerStepPath(analysis.powerPlateaus, knots, tMax, xOf, yPower);
  const powerArea = `${powerLine} L ${xOf(tMax)} ${yBase} L ${xOf(0)} ${yBase} Z`;
  const energyLine = buildEnergyPath(analysis.powerPlateaus, knots, xOf, yEnergy);

  const gridLines: string[] = [];
  const xTicks: string[] = [];
  for (const t of knots) {
    const x = xOf(t);
    const major = t === 0 || stepEnds.has(t) || t >= tMax - 1e-9;
    gridLines.push(
      `<line x1="${x}" y1="${mt}" x2="${x}" y2="${yBase}" stroke="${major ? "#94a3b8" : "#cbd5e1"}" stroke-width="${major ? 1.5 : 1}" ${major ? "" : 'stroke-dasharray="3 3"'} />`
    );
    if (major) {
      xTicks.push(
        `<text x="${x}" y="${H - 18}" text-anchor="middle" font-size="11" fill="#475569">${escXml(fmtAxis(t))}</text>`
      );
    }
  }

  const yTicksL: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const q = (maxQ * i) / 4;
    const y = yPower(q);
    yTicksL.push(`<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />`);
    yTicksL.push(
      `<text x="${ml - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#2563eb">${escXml(fmtAxis(q))}</text>`
    );
  }

  const yTicksR: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const e = (maxE * i) / 4;
    const y = yEnergy(e);
    yTicksR.push(
      `<text x="${W - mr + 6}" y="${y + 4}" text-anchor="start" font-size="10" fill="#ea580c">${escXml(fmtAxis(e))}</text>`
    );
  }

  const stepLabels: string[] = [];
  let t0 = 0;
  for (const seg of analysis.stepPlateaus) {
    const xm = xOf((t0 + seg.tEndDays) / 2);
    stepLabels.push(
      `<text x="${xm}" y="${mt - 10}" text-anchor="middle" font-size="10" fill="#64748b">${escXml(`${seg.stepCount}×Δt≈${fmtAxis(seg.dtDays)}`)}</text>`
    );
    t0 = seg.tEndDays;
  }

  const substepMarkers = knots
    .filter((t) => t > 0 && t < tMax && !stepEnds.has(t))
    .map((t) => `<circle cx="${xOf(t)}" cy="${yBase - 4}" r="2.5" fill="#64748b"/>`)
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${W / 2}" y="18" text-anchor="middle" font-size="13" font-weight="600" fill="#1e293b">Профиль нагрузки и энерговыработка</text>
  ${yTicksL.join("\n  ")}
  ${gridLines.join("\n  ")}
  <path d="${powerArea}" fill="#3b82f6" fill-opacity="0.22" stroke="none"/>
  <path d="${powerLine}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
  <path d="${energyLine}" fill="none" stroke="#ea580c" stroke-width="2.5"/>
  ${substepMarkers}
  ${stepLabels.join("\n  ")}
  ${xTicks.join("\n  ")}
  ${yTicksR.join("\n  ")}
  <line x1="${ml}" y1="${yBase}" x2="${W - mr}" y2="${yBase}" stroke="#334155" stroke-width="1.2"/>
  <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${yBase}" stroke="#2563eb" stroke-width="1.2"/>
  <line x1="${W - mr}" y1="${mt}" x2="${W - mr}" y2="${yBase}" stroke="#ea580c" stroke-width="1.2"/>
  <text x="${ml - 38}" y="${mt + ph / 2}" transform="rotate(-90 ${ml - 38} ${mt + ph / 2})" text-anchor="middle" font-size="11" fill="#2563eb">Q, кВт</text>
  <text x="${W - mr + 42}" y="${mt + ph / 2}" transform="rotate(90 ${W - mr + 42} ${mt + ph / 2})" text-anchor="middle" font-size="11" fill="#ea580c">∫Q·dt, кВт·сут</text>
  <text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#475569">Время, сут</text>
  <rect x="${ml}" y="${H - 38}" width="10" height="10" fill="#3b82f6" fill-opacity="0.35" stroke="#2563eb"/>
  <text x="${ml + 14}" y="${H - 29}" font-size="10" fill="#334155">Мощность Q(T)</text>
  <line x1="${ml + 120}" y1="${H - 33}" x2="${ml + 140}" y2="${H - 33}" stroke="#ea580c" stroke-width="2.5"/>
  <text x="${ml + 144}" y="${H - 29}" font-size="10" fill="#334155">Энерговыработка</text>
  <line x1="${ml + 268}" y1="${H - 33}" x2="${ml + 288}" y2="${H - 33}" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="${ml + 292}" y="${H - 29}" font-size="10" fill="#334155">граница шага</text>
  <line x1="${ml + 388}" y1="${H - 33}" x2="${ml + 408}" y2="${H - 33}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="${ml + 412}" y="${H - 29}" font-size="10" fill="#334155">подшаг</text>
</svg>`;
}

export function burnupLoadSvgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function fmtHoverNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "∞";
  if (Math.abs(n) >= 1e4 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toPrecision(digits);
  return n.toPrecision(digits).replace(/\.?0+$/, "");
}

export function formatBurnupLoadHover(analysis: BurnupLoadAnalysis, ast?: DocumentAst): string {
  const lines: string[] = ["", "---", "### Профиль нагрузки (STEP + POWER)"];

  const massRows = ast ? buildMaterialMassRows(ast) : [];
  const totalMassG = massRows.length ? totalMaterialMassG(massRows) : 0;

  if (analysis.totalTimeDays > 0) {
    const svg = renderBurnupLoadSvg(analysis);
    lines.push("", `![Профиль нагрузки](${burnupLoadSvgDataUri(svg)})`);
  }

  if (analysis.stepPlateaus.length) {
    lines.push(
      "",
      analysis.stepIncremental
        ? "*Время STEP: второе и далее t — длины отрезков (сут), суммируются (DSTP).*"
        : "*Время STEP: t — накопленная граница интервала (сут).*",
      `**Кампания:** ${fmtHoverNum(analysis.totalTimeDays)} сут · **${analysis.totalSteps}** шаг(ов) выгорания`
    );
  }

  if (analysis.powerPlateaus.length && analysis.totalTimeDays > 0) {
    const tableRows = analysis.powerPlateaus
      .filter((p) => Number.isFinite(p.tEndDays))
      .map((p, i, arr) => {
        const t0 = i === 0 ? 0 : arr[i - 1].tEndDays;
        return `| ${fmtHoverNum(t0)} – ${fmtHoverNum(p.tEndDays)} | ${fmtHoverNum(p.qKw)} |`;
      });
    if (analysis.powerPlateaus.some((p) => !Number.isFinite(p.tEndDays))) {
      const last = analysis.powerPlateaus[analysis.powerPlateaus.length - 1];
      const t0 =
        analysis.powerPlateaus.length > 1
          ? analysis.powerPlateaus[analysis.powerPlateaus.length - 2].tEndDays
          : 0;
      tableRows.push(`| ≥ ${fmtHoverNum(t0)} | ${fmtHoverNum(last.qKw)} |`);
    }
    if (tableRows.length) {
      lines.push("", "| T, сут | Q, кВт |", "| --- | --- |", ...tableRows);
    }
    lines.push("", `**Энерговыработка:** ${formatEnergyOutput(analysis.totalEnergyKwd)}`);
    const specific = formatSpecificBurnupMwdPerKg(analysis.totalEnergyKwd, totalMassG);
    if (specific) {
      lines.push(`**Удельная энерговыработка:** ${specific}`);
    }
  }

  if (massRows.length) {
    lines.push("", "### Материалы (VOL × ρ)", formatMaterialMassTable(massRows));
  }

  return lines.join("\n");
}
