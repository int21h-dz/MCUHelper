/**
 * Бандл + кэш PNNL Materials Compendium (slim gzip).
 * Словарь names.ru.json только из VSIX — refresh его не трогает.
 */

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as zlib from "zlib";
import * as vscode from "vscode";
import {
  loadCatalogJson,
  loadMaterialsCompendiumApi,
  loadNameTranslations,
  slimMaterialsCompendium,
  type SlimCatalog,
  type UserCatalogFile,
} from "./mcuLanguageBridge";

const CONTENTS_URL =
  "https://api.github.com/repos/pyne/materials-compendium/contents/src/materials_compendium/MaterialsCompendium.json?ref=develop";
const RAW_URL =
  "https://raw.githubusercontent.com/pyne/materials-compendium/develop/src/materials_compendium/MaterialsCompendium.json";

export interface CatalogMeta {
  sourceSha: string;
  siteVersion?: string;
  generatedAt?: string;
  materialCount?: number;
}

export interface LoadedCatalog {
  catalog: SlimCatalog;
  meta: CatalogMeta;
  source: "bundled" | "cache";
  translations: Record<string, string>;
}

export function parseGithubFileMeta(payload: unknown): { sha: string; downloadUrl: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const sha = typeof rec.sha === "string" ? rec.sha : "";
  if (!sha) return null;
  const downloadUrl = typeof rec.download_url === "string" && rec.download_url ? rec.download_url : RAW_URL;
  return { sha, downloadUrl };
}

/** Кэш — живое обновление; новый VSIX с более свежим generatedAt побеждает кэш. */
export function pickCatalogSource(bundled: CatalogMeta, cache: CatalogMeta | null): "bundled" | "cache" {
  if (!cache?.sourceSha) return "bundled";
  if (cache.sourceSha === bundled.sourceSha) return "bundled";
  if (bundled.generatedAt && cache.generatedAt && bundled.generatedAt > cache.generatedAt) return "bundled";
  return "cache";
}

function readMetaFile(file: string): CatalogMeta | null {
  try {
    const rec = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogMeta;
    if (!rec || typeof rec.sourceSha !== "string") return null;
    return rec;
  } catch {
    return null;
  }
}

function readGzipCatalog(file: string): SlimCatalog | null {
  try {
    const json = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    return loadCatalogJson(JSON.parse(json));
  } catch {
    return null;
  }
}

function bundledDir(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, "media", "materialsCompendium");
}

function cacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "materialsCompendium");
}

/** Рядом с кэшем catalog.json.gz; не в VSIX, refresh/апдейт не трогают. */
export const USER_CATALOG_FILENAME = "userCatalog.json";

export function userCatalogPath(context: vscode.ExtensionContext): string {
  return path.join(cacheDir(context), USER_CATALOG_FILENAME);
}

export function loadUserCatalog(context: vscode.ExtensionContext): UserCatalogFile {
  const api = loadMaterialsCompendiumApi();
  const file = userCatalogPath(context);
  try {
    return api.parseUserCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { version: 1, materials: [] };
  }
}

export function saveUserCatalog(context: vscode.ExtensionContext, file: UserCatalogFile): void {
  const dir = cacheDir(context);
  fs.mkdirSync(dir, { recursive: true });
  const api = loadMaterialsCompendiumApi();
  fs.writeFileSync(userCatalogPath(context), api.formatUserCatalogJson(file), "utf8");
}

export function loadBundledMeta(context: vscode.ExtensionContext): CatalogMeta | null {
  return readMetaFile(path.join(bundledDir(context).fsPath, "meta.json"));
}

function loadTranslations(context: vscode.ExtensionContext): Record<string, string> {
  const file = path.join(bundledDir(context).fsPath, "names.ru.json");
  try {
    const rec = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    return rec && typeof rec === "object" ? rec : {};
  } catch {
    return {};
  }
}

export function loadMaterialsCatalog(context: vscode.ExtensionContext): LoadedCatalog {
  const bundledMeta = loadBundledMeta(context) ?? { sourceSha: "" };
  const cacheRoot = cacheDir(context);
  const cacheMeta = readMetaFile(path.join(cacheRoot, "meta.json"));
  const source = pickCatalogSource(bundledMeta, cacheMeta);
  const translations = loadTranslations(context);
  loadNameTranslations(translations);

  if (source === "cache") {
    const cat = readGzipCatalog(path.join(cacheRoot, "catalog.json.gz"));
    if (cat && cacheMeta) {
      return { catalog: cat, meta: cacheMeta, source: "cache", translations };
    }
  }
  const bundledCat = readGzipCatalog(path.join(bundledDir(context).fsPath, "catalog.json.gz"));
  if (!bundledCat) {
    throw new Error("Нет бандла справочника материалов (catalog.json.gz). Пересоберите расширение.");
  }
  return { catalog: bundledCat, meta: bundledMeta, source: "bundled", translations };
}

function fetchBuffer(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, headers, timeoutMs).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

export async function checkMaterialsCompendiumUpdate(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<void> {
  const bundled = loadBundledMeta(context);
  const cacheMeta = readMetaFile(path.join(cacheDir(context), "meta.json"));
  const localSha = cacheMeta?.sourceSha || bundled?.sourceSha || "";

  try {
    const infoBuf = await fetchBuffer(
      CONTENTS_URL,
      { Accept: "application/vnd.github+json", "User-Agent": "MCU-NR-Helper" },
      12000
    );
    const remote = parseGithubFileMeta(JSON.parse(infoBuf.toString("utf8")));
    if (!remote) {
      output?.appendLine("Справочник материалов: GitHub не вернул SHA");
      return;
    }
    output?.appendLine(
      `Справочник материалов: локальный SHA ${localSha.slice(0, 12) || "—"}, удалённый ${remote.sha.slice(0, 12)}`
    );
    if (remote.sha === localSha) return;

    output?.appendLine("Справочник материалов: скачивание и зачистка…");
    const rawBuf = await fetchBuffer(
      remote.downloadUrl,
      { "User-Agent": "MCU-NR-Helper" },
      180000
    );
    const raw = JSON.parse(rawBuf.toString("utf8"));
    const catalog = slimMaterialsCompendium(raw, {
      sourceSha: remote.sha,
      generatedAt: new Date().toISOString(),
    });
    catalog.sourceSha = remote.sha;
    const json = JSON.stringify(catalog);
    const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const dir = cacheDir(context);
    fs.mkdirSync(dir, { recursive: true });
    // userCatalog.json в этой же папке не трогаем — банк пользователя.
    fs.writeFileSync(path.join(dir, "catalog.json.gz"), gz);
    const meta: CatalogMeta = {
      sourceSha: remote.sha,
      siteVersion: catalog.siteVersion,
      generatedAt: catalog.generatedAt,
      materialCount: catalog.materialCount,
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    output?.appendLine(
      `Справочник материалов: обновлён (${catalog.materialCount} позиций, ${gz.length} байт gzip). names.ru.json не изменён.`
    );
  } catch (error) {
    output?.appendLine(
      `Справочник материалов: обновление пропущено (${error instanceof Error ? error.message : String(error)})`
    );
  }
}
