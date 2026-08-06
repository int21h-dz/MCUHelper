/**
 * Чистые хелперы DEFAULT.PHY: путь в MDBNR, опции ACE/PHT, кодировка записи.
 * Без vscode — покрываются node:test.
 */

import * as fs from "fs";
import * as path from "path";

export type McuEncodingId = "utf8" | "win1251" | "cp866" | "koi8-r";

type EncodingMod = {
  detectEncodingFromBuffer: (buf: Buffer) => { encoding: McuEncodingId };
  decodeBuffer: (buf: Buffer, encoding?: McuEncodingId) => string;
  encodeBuffer: (text: string, encoding?: McuEncodingId) => Buffer;
};

function loadEncodingMod(): EncodingMod {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", "encodingDetect.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "encodingDetect.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p) as EncodingMod;
    }
  }
  throw new Error("encodingDetect не найден. Выполните npm run build в корне проекта.");
}

export const DEFAULT_PHY_BASENAME = "DEFAULT.PHY";

const LIB_SCAN_DIRS = ["ACE", "GAMTRA"] as const;

/** Case-insensitive поиск DEFAULT.PHY в корне MDBNR. */
export function resolveDefaultPhyPath(libRoot: string): string | undefined {
  const root = libRoot?.trim();
  if (!root || !fs.existsSync(root)) return undefined;
  const direct = path.join(root, DEFAULT_PHY_BASENAME);
  if (fs.existsSync(direct)) return direct;
  const lower = path.join(root, "default.phy");
  if (fs.existsSync(lower)) return lower;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toUpperCase() === DEFAULT_PHY_BASENAME) {
        return path.join(root, ent.name);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function defaultPhyTargetPath(libRoot: string): string {
  return resolveDefaultPhyPath(libRoot) ?? path.join(libRoot.trim(), DEFAULT_PHY_BASENAME);
}

/** Расширения файлов в ACE/ и GAMTRA/ (глубина 1, без рекурсии). */
export function listLibraryExtensions(libRoot: string): { ace: string[]; pht: string[] } {
  const ace = new Set<string>();
  const pht = new Set<string>();
  const root = libRoot?.trim();
  if (!root || !fs.existsSync(root)) return { ace: [], pht: [] };

  for (const dirName of LIB_SCAN_DIRS) {
    const dir = path.join(root, dirName);
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).replace(/^\./, "");
      if (!ext) continue;
      if (dirName === "ACE") ace.add(ext);
      else pht.add(ext);
    }
  }

  return {
    ace: [...ace].sort((a, b) => a.localeCompare(b)),
    pht: [...pht].sort((a, b) => a.localeCompare(b)),
  };
}

export function mergeOptionLists(...lists: string[][]): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const v of list) {
      if (v && v.trim()) set.add(v.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface LoadedDefaultPhyBytes {
  text: string;
  encoding: McuEncodingId;
  mtimeMs: number;
}

export function loadDefaultPhyBytes(filePath: string): LoadedDefaultPhyBytes {
  const enc = loadEncodingMod();
  const buf = fs.readFileSync(filePath);
  const detected = enc.detectEncodingFromBuffer(buf);
  const text = enc.decodeBuffer(buf, detected.encoding);
  const st = fs.statSync(filePath);
  return { text, encoding: detected.encoding, mtimeMs: st.mtimeMs };
}

/** Atomic write: temp рядом + rename; опциональный .bak перед перезаписью. */
export function writeDefaultPhyAtomic(
  filePath: string,
  text: string,
  encoding: McuEncodingId,
  options?: { backup?: boolean }
): void {
  const enc = loadEncodingMod();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const exists = fs.existsSync(filePath);
  if (options?.backup && exists) {
    fs.copyFileSync(filePath, filePath + ".bak");
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const buf = enc.encodeBuffer(text, encoding);
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  }
}

export function fileMtimeMs(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Путь лежит внутри корня MDBNR (для confirm при Save). */
export function isPathUnderLibRoot(filePath: string, libRoot: string): boolean {
  const root = path.resolve(libRoot.trim());
  const file = path.resolve(filePath);
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
