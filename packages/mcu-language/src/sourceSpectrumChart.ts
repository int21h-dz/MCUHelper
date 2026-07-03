import type { SourceSpectrumBlock } from "./sourceSpectrum";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtAxis(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 100) return n.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(n) >= 10) return n.toFixed(2).replace(/\.?0+$/, "");
  if (Math.abs(n) >= 1) return n.toFixed(3).replace(/\.?0+$/, "");
  return n.toPrecision(3).replace(/\.?0+$/, "");
}

function fmtEnergyEv(eV: number): string {
  const mev = eV / 1e6;
  if (mev >= 1) return `${fmtAxis(mev)}`;
  if (mev > 0) return `${fmtAxis(mev * 1000)}×10³`;
  return "0";
}

export function renderSourceSpectrumSvg(block: SourceSpectrumBlock): string {
  const n = Math.min(block.energies.length, block.probabilities.length);
  if (n < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="80"><text x="12" y="40" font-size="13" fill="#64748b">Недостаточно узлов EMES/EPRO</text></svg>`;
  }

  const points: { e: number; p: number }[] = [];
  for (let i = 0; i < n; i++) {
    points.push({ e: block.energies[i], p: block.probabilities[i] });
  }

  const eMin = Math.min(...points.map((pt) => pt.e));
  const eMax = Math.max(...points.map((pt) => pt.e));
  const pMin = Math.min(...points.map((pt) => pt.p));
  const pMax = Math.max(...points.map((pt) => pt.p));
  const eSpan = eMax - eMin || 1;
  const pSpan = pMax - pMin || 1;

  const W = 520;
  const H = 280;
  const ml = 56;
  const mr = 16;
  const mt = 40;
  const mb = 48;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const yBase = mt + ph;

  const xOf = (e: number) => ml + ((e - eMin) / eSpan) * pw;
  const yOf = (p: number) => mt + ph - ((p - pMin) / pSpan) * ph;

  const linePath = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${xOf(pt.e)} ${yOf(pt.p)}`).join(" ");
  const areaPath = `${linePath} L ${xOf(points[n - 1].e)} ${yBase} L ${xOf(points[0].e)} ${yBase} Z`;

  const dots = points
    .map((pt) => `<circle cx="${xOf(pt.e)}" cy="${yOf(pt.p)}" r="2.2" fill="#7c3aed" stroke="#fff" stroke-width="0.6"/>`)
    .join("\n  ");

  const yGrid: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const p = pMin + (pSpan * i) / 4;
    const y = yOf(p);
    yGrid.push(`<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`);
    yGrid.push(
      `<text x="${ml - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#7c3aed">${escXml(fmtAxis(p))}</text>`
    );
  }

  const xTicks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const e = eMin + (eSpan * i) / 4;
    const x = xOf(e);
    xTicks.push(`<line x1="${x}" y1="${mt}" x2="${x}" y2="${yBase}" stroke="#e2e8f0" stroke-width="1"/>`);
    xTicks.push(
      `<text x="${x}" y="${H - 22}" text-anchor="middle" font-size="10" fill="#475569">${escXml(fmtEnergyEv(e))}</text>`
    );
  }

  const title = block.name ? `Спектр «${block.name}» (EMES × EPRO)` : "Спектр источника (EMES × EPRO)";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${W / 2}" y="20" text-anchor="middle" font-size="13" font-weight="600" fill="#1e293b">${escXml(title)}</text>
  <text x="${W / 2}" y="34" text-anchor="middle" font-size="10" fill="#64748b">${n} узлов · E: ${escXml(fmtEnergyEv(eMin))}…${escXml(fmtEnergyEv(eMax))} МэВ</text>
  ${yGrid.join("\n  ")}
  ${xTicks.join("\n  ")}
  <path d="${areaPath}" fill="#8b5cf6" fill-opacity="0.18" stroke="none"/>
  <path d="${linePath}" fill="none" stroke="#7c3aed" stroke-width="2.2"/>
  ${dots}
  <line x1="${ml}" y1="${yBase}" x2="${W - mr}" y2="${yBase}" stroke="#334155" stroke-width="1.2"/>
  <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${yBase}" stroke="#7c3aed" stroke-width="1.2"/>
  <text x="${ml - 42}" y="${mt + ph / 2}" transform="rotate(-90 ${ml - 42} ${mt + ph / 2})" text-anchor="middle" font-size="11" fill="#7c3aed">P (EPRO)</text>
  <text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#475569">Энергия E, МэВ</text>
</svg>`;
}

export function sourceSpectrumSvgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function formatSourceSpectrumHover(block: SourceSpectrumBlock): string {
  const n = Math.min(block.energies.length, block.probabilities.length);
  const lines: string[] = ["", "---", "### Зависимость P(E)"];

  if (block.energies.length !== block.probabilities.length) {
    lines.push(
      "",
      `⚠️ Число узлов EMES (${block.energies.length}) ≠ EPRO (${block.probabilities.length}); на графике **${n}** пар.`
    );
  }

  const svg = renderSourceSpectrumSvg(block);
  lines.push("", `![Спектр P(E)](${sourceSpectrumSvgDataUri(svg)})`);

  const show = Math.min(6, n);
  const tableRows: string[] = [];
  for (let i = 0; i < show; i++) {
    tableRows.push(`| ${block.energies[i].toPrecision(4)} | ${block.probabilities[i].toPrecision(4)} |`);
  }
  if (n > show * 2) {
    tableRows.push("| … | … |");
    for (let i = n - show; i < n; i++) {
      tableRows.push(`| ${block.energies[i].toPrecision(4)} | ${block.probabilities[i].toPrecision(4)} |`);
    }
  } else if (n > show) {
    for (let i = show; i < n; i++) {
      tableRows.push(`| ${block.energies[i].toPrecision(4)} | ${block.probabilities[i].toPrecision(4)} |`);
    }
  }

  lines.push("", "| E, эВ | P |", "| --- | --- |", ...tableRows);
  lines.push("", `*Дискретные узлы EMES и вероятности EPRO (модуль источников).*`);

  return lines.join("\n");
}
