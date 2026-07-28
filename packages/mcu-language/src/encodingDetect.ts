/**
 * Автоопределение кодировки legacy-файлов MCU-NR (UTF-8, Windows-1251, CP866, KOI8-R).
 * Используется расширением VS Code и препроцессором #include.
 */

import iconv from "iconv-lite";
import * as fs from "fs";
import { scoreMcunrContent } from "./detect";

export type McuEncodingId = "utf8" | "win1251" | "cp866" | "koi8-r";

export interface EncodingDetectionResult {
  /** Имя для iconv-lite / decodeBuffer. */
  encoding: McuEncodingId;
  /** Имя для VS Code (openTextDocument / reopenWithEncoding). */
  vscodeEncoding: string;
  confidence: number;
  /** true — можно безопасно переоткрыть файл с другой кодировкой. */
  shouldReopen: boolean;
}

const CANDIDATES: readonly McuEncodingId[] = ["utf8", "win1251", "cp866", "koi8-r"];

const VSCODE_ENCODING: Record<McuEncodingId, string> = {
  utf8: "utf8",
  win1251: "windows1251",
  cp866: "cp866",
  "koi8-r": "koi8r",
};

/** Минимальный выигрыш score над UTF-8, чтобы считать кодировку уверенной. */
const CONFIDENCE_MARGIN = 12;

function hasHighBytes(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7f) return true;
  }
  return false;
}

function stripBom(buf: Buffer): { body: Buffer; bomEncoding?: McuEncodingId } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { body: buf.subarray(3), bomEncoding: "utf8" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { body: buf.subarray(2), bomEncoding: "utf8" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { body: buf.subarray(2), bomEncoding: "utf8" };
  }
  return { body: buf };
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function scoreDecodedText(text: string): number {
  let score = 0;

  const mcu = scoreMcunrContent(text);
  if (mcu.isMcunr) score += 80 + mcu.score;

  const cyrillic = (text.match(/[\u0400-\u04FF\u0451\u0401]/g) ?? []).length;
  const replacement = (text.match(/\uFFFD/g) ?? []).length;
  const controls = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) ?? []).length;
  const mojibake = (text.match(/(?:Ã.|Ð.|Ñ.|Ò.|â€)/g) ?? []).length;

  score += cyrillic * 3;
  score -= replacement * 40;
  score -= controls * 15;
  score -= mojibake * 25;

  /** Комментарии MCU-NR: ** или C= — часто кириллица в legacy. */
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("**") || t.startsWith("C=")) {
      if (/[\u0400-\u04FF]/.test(t)) score += 8;
    }
  }

  return score;
}

function normalizeNewlines(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function decodeBuffer(buf: Buffer, encoding: McuEncodingId = "utf8"): string {
  if (encoding === "utf8") {
    return normalizeNewlines(buf.toString("utf8"));
  }
  return normalizeNewlines(iconv.decode(buf, encoding));
}

export function detectEncodingFromBuffer(buf: Buffer): EncodingDetectionResult {
  const { body, bomEncoding } = stripBom(buf);

  if (!hasHighBytes(body)) {
    return {
      encoding: bomEncoding ?? "utf8",
      vscodeEncoding: VSCODE_ENCODING[bomEncoding ?? "utf8"],
      confidence: 100,
      shouldReopen: false,
    };
  }

  const utf8Valid = isValidUtf8(body);
  if (utf8Valid && !bomEncoding) {
    return {
      encoding: "utf8",
      vscodeEncoding: VSCODE_ENCODING.utf8,
      confidence: 100,
      shouldReopen: false,
    };
  }

  let best: McuEncodingId = bomEncoding ?? (utf8Valid ? "utf8" : "win1251");
  let bestScore = -Infinity;
  const scores = new Map<McuEncodingId, number>();

  for (const enc of CANDIDATES) {
    if (enc === "utf8" && !utf8Valid && !bomEncoding) {
      scores.set(enc, -1000);
      continue;
    }
    const text = decodeBuffer(body, enc);
    const s = scoreDecodedText(text);
    scores.set(enc, s);
    if (s > bestScore) {
      bestScore = s;
      best = enc;
    }
  }

  const utf8Score = scores.get("utf8") ?? -1000;
  const margin = bestScore - utf8Score;
  const shouldReopen = best !== "utf8" && margin >= CONFIDENCE_MARGIN;

  return {
    encoding: best,
    vscodeEncoding: VSCODE_ENCODING[best],
    confidence: Math.max(0, Math.min(100, margin + (shouldReopen ? 20 : 0))),
    shouldReopen,
  };
}

export function readTextFileWithDetectedEncoding(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const detected = detectEncodingFromBuffer(buf);
  return decodeBuffer(stripBom(buf).body, detected.encoding);
}

/** Текст на диске совпадает с тем, что видит редактор при указанной кодировке. */
export function diskTextMatchesEditor(buf: Buffer, editorText: string): boolean {
  const detected = detectEncodingFromBuffer(buf);
  const fromDisk = decodeBuffer(stripBom(buf).body, detected.encoding);
  return normalizeNewlines(fromDisk) === normalizeNewlines(editorText);
}

export function toVscodeEncoding(encoding: McuEncodingId): string {
  return VSCODE_ENCODING[encoding];
}
