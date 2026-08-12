/**
 * Извлекает описания карт MCU-NR из UserGuide TXT → userGuideCards.generated.ts
 * Запуск: node scripts/extract-userguide-cards.mjs (из packages/mcu-schema)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_MCU_LABELS, detectFragmentFromLabel } from "../dist/keywords.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const TXT = path.join(ROOT, "docs/MCU-NR_UserGuide_220519.txt");
const OUT = path.join(__dirname, "../src/userGuideCards.generated.ts");

/** Карты вне PDF или с нестандартным описанием (RUNTEST, практика). */
const MANUAL = {
  ECPO: {
    syntax: "ECPO e1",
    description:
      "Нижняя граница энергии позитрона (эВ); траектории ниже прерываются. Аналог ECUT/ECUP/ECEL для позитронов. По умолчанию как у электронов — 100 эВ. Редактируется в процессе счёта.",
    fragment: "calculationControl",
  },
  BETA: {
    syntax: "BETA",
    description:
      "При наличии карты вычисляется эффективная доля запаздывающих нейтронов. Редактированию не подлежит.",
    fragment: "calculationControl",
  },
  CAL: { aliasOf: "CALD" },
  REG: { aliasOf: "REGD" },
  SRC: { aliasOf: "SRCD" },
  TRJ: { aliasOf: "TRJD" },
  BURD: { aliasOf: "BURN" },
  BURNUP: { aliasOf: "BURN" },
  BRGD: { aliasOf: "BRG" },
  POWER: { aliasOf: "POWE" },
  NPRINT: { aliasOf: "NPRI" },
  NPRIN: { aliasOf: "NPRI" },
  NBAT: { aliasOf: "NBATCH" },
  MAXSER: { aliasOf: "MAXS" },
  DTZML: { aliasOf: "DTZM" },
  FISZON: { aliasOf: "FISZ" },
  ZONPRI: { aliasOf: "ZONP" },
  SUMZON: { aliasOf: "SUMZ" },
  NAMVAR: { aliasOf: "NAMV" },
  MIR: {
    syntax: "MIR P Q",
    description:
      "Задаёт плоскость симметрии контейнера: (P·x)+Q=0. Вектор P направлен внутрь контейнера.",
    fragment: "geometry",
  },
};

const cards = new Map();

function addCard(label, syntax, description, fragment) {
  const u = label.toUpperCase();
  if (!ALL_MCU_LABELS.has(u)) return;
  const desc = description.replace(/\s+/g, " ").trim();
  if (desc.length < 8) return;
  const frag = fragment ?? detectFragmentFromLabel(u, null) ?? undefined;
  const prev = cards.get(u);
  if (!prev || desc.length > prev.description.length) {
    cards.set(u, {
      label: u,
      title: u,
      syntax: syntax || `${u} …`,
      description: desc,
      fragment: frag,
    });
  }
}

function isKnownLabel(word) {
  return ALL_MCU_LABELS.has(word.toUpperCase());
}

function isNewCardLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("===== PAGE")) return Boolean(t);
  const dash = t.match(/^([A-Z][A-Z0-9]{1,5})\s*[–\-]/);
  if (dash && isKnownLabel(dash[1])) return true;
  const multiDash = t.match(/^([A-Z][A-Z0-9]{1,5}(?:\s*,\s*[A-Z][A-Z0-9]{1,5})+)\s*[–\-]/);
  if (multiDash) return true;
  const param = t.match(/^([A-Z][A-Z0-9]{1,5})\s{2,}([a-z][a-z0-9]*)\s*$/);
  if (param && isKnownLabel(param[1])) return true;
  return false;
}

/** Описание карты «LABEL – …» в TXT часто переносится на следующую строку (PDF). */
function mergeDashDescription(lines, startIdx, initial) {
  let desc = initial.trim();
  for (let j = startIdx + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (!t) {
      if (desc.endsWith(".")) break;
      continue;
    }
    if (isNewCardLine(lines[j])) break;
    desc += " " + t;
    if (desc.length > 600 || desc.endsWith(".")) break;
  }
  return desc.replace(/\s+/g, " ").trim();
}

function collectDescription(lines, startIdx) {
  const parts = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("===== PAGE")) break;
    if (/^([A-Z][A-Z0-9]{1,5})\s*[–\-]/.test(line) && isKnownLabel(line.match(/^([A-Z][A-Z0-9]{1,5})/)[1])) {
      if (parts.length > 0) break;
    }
    const param = line.match(/^([A-Z][A-Z0-9]{1,5})\s{2,}([a-z][a-z0-9]*)\s*$/);
    if (param && isKnownLabel(param[1]) && parts.length > 0) break;
    if (/^\d+(\.\d+)*\s/.test(line) && parts.length > 0) break;
    const t = line.trim();
    if (!t) {
      if (parts.length > 0 && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (/^([A-Z][A-Z0-9]{1,5})\s/.test(next) && isKnownLabel(next.split(/\s/)[0])) break;
      }
      continue;
    }
    parts.push(t);
    if (parts.join(" ").length > 600) break;
  }
  return parts.join(" ");
}

const text = fs.readFileSync(TXT, "utf8");
const lines = text.split(/\r?\n/);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const multiDash = line.match(/^([A-Z][A-Z0-9]{1,5}(?:\s*,\s*[A-Z][A-Z0-9]{1,5})+)\s*[–\-]\s*(.+)$/);
  if (multiDash) {
    const labels = multiDash[1].split(/\s*,\s*/);
    const desc = mergeDashDescription(lines, i, multiDash[2]);
    for (const raw of labels) {
      if (isKnownLabel(raw)) addCard(raw, `${raw.toUpperCase()} …`, desc, null);
    }
    continue;
  }

  const dash = line.match(/^([A-Z][A-Z0-9]{1,5})\s*[–\-]\s*(.+)$/);
  if (dash && isKnownLabel(dash[1])) {
    addCard(dash[1], `${dash[1].toUpperCase()} …`, mergeDashDescription(lines, i, dash[2]), null);
    continue;
  }

  const param = line.match(/^([A-Z][A-Z0-9]{1,5})\s{2,}([a-z][a-z0-9]*)\s*$/);
  if (param && isKnownLabel(param[1])) {
    const label = param[1].toUpperCase();
    const syntax = `${label} ${param[2]}`;
    const desc = collectDescription(lines, i + 1);
    if (desc) addCard(label, syntax, desc, null);
    continue;
  }

  const syntaxBlock = line.match(/^([A-Z][A-Z0-9]{1,5})\s+(\[[^\]]+\].*)$/);
  if (syntaxBlock && isKnownLabel(syntaxBlock[1])) {
    const label = syntaxBlock[1].toUpperCase();
    let desc = "";
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const l = lines[j];
      if (l.includes(`${label}`) || l.toLowerCase().includes("имя карты")) {
        desc = collectDescription(lines, j);
        break;
      }
    }
    if (desc) addCard(label, line.trim(), desc, null);
    continue;
  }

  const angleSyntax = line.match(/^([A-Z][A-Z0-9]{1,5})\s{2,}<[^>]+>/);
  if (angleSyntax && isKnownLabel(angleSyntax[1])) {
    const label = angleSyntax[1].toUpperCase();
    const desc = collectDescription(lines, i + 1);
    if (desc) addCard(label, line.trim(), desc, null);
    continue;
  }

  const proseCard = line.match(/карт[аы]\w*\s+(?:с\s+меткой\s+)?([A-Z][A-Z0-9]{1,5})\b/i);
  if (proseCard && isKnownLabel(proseCard[1])) {
    addCard(proseCard[1], `${proseCard[1].toUpperCase()} …`, line.trim(), null);
    continue;
  }

  const bracketTemplate = line.match(/^\[([A-Z][A-Z0-9]{1,5})\s+([^\]]*)\]/);
  if (bracketTemplate && isKnownLabel(bracketTemplate[1])) {
    const label = bracketTemplate[1].toUpperCase();
    const desc = collectDescription(lines, i + 1);
    addCard(label, `${label} ${bracketTemplate[2].trim()}`, desc || line.trim(), null);
  }
}

for (const [label, spec] of Object.entries(MANUAL)) {
  if (spec.aliasOf) continue;
  addCard(label, spec.syntax, spec.description, spec.fragment);
}

const sorted = [...cards.values()].sort((a, b) => a.label.localeCompare(b.label));

const body = `/** AUTO-GENERATED by scripts/extract-userguide-cards.mjs — не править вручную */

export const USER_GUIDE_CARDS = ${JSON.stringify(sorted, null, 2)} as const;
`;

fs.writeFileSync(OUT, body, "utf8");
console.log(`Wrote ${sorted.length} cards to ${path.relative(ROOT, OUT)}`);
