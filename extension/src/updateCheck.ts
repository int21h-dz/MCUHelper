import * as https from "https";
import * as vscode from "vscode";

const RELEASES_API_URL = "https://api.github.com/repos/int21h-dz/MCUHelper/releases/latest";

export interface ReleaseInfo {
  version: string;
  url: string;
  label: string;
}

function parseVersionParts(version: string): number[] | null {
  const match = version.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ];
}

export function normalizeVersionString(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const dottedMatches = Array.from(raw.matchAll(/(\d+\.\d+(?:\.\d+)?)/g));
  const preferred = dottedMatches.length > 0 ? dottedMatches[dottedMatches.length - 1]?.[1] : raw;
  const parts = parseVersionParts(preferred ?? raw);
  if (!parts) return null;
  return parts.join(".");
}

export function compareNormalizedVersions(left: string, right: string): number {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  if (!a || !b) {
    return left.localeCompare(right);
  }
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function parseLatestReleaseInfo(payload: unknown): ReleaseInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const url = typeof rec.html_url === "string" ? rec.html_url : "https://github.com/int21h-dz/MCUHelper/releases";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  const tag = typeof rec.tag_name === "string" ? rec.tag_name.trim() : "";
  const version = normalizeVersionString(name) ?? normalizeVersionString(tag);
  if (!version) return null;
  return {
    version,
    url,
    label: name || tag || version,
  };
}

export function isNewerRelease(currentVersion: string, latestVersion: string): boolean {
  const current = normalizeVersionString(currentVersion);
  const latest = normalizeVersionString(latestVersion);
  if (!current || !latest) return false;
  return compareNormalizedVersions(latest, current) > 0;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "MCU-NR-Helper",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

export async function checkForExtensionUpdates(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<void> {
  const currentVersion = normalizeVersionString(context.extension.packageJSON.version);
  if (!currentVersion) {
    output?.appendLine("Проверка обновлений: не удалось распознать текущую версию расширения");
    return;
  }

  try {
    const payload = await fetchJson(RELEASES_API_URL);
    const release = parseLatestReleaseInfo(payload);
    if (!release) {
      output?.appendLine("Проверка обновлений: GitHub вернул релиз без распознаваемой версии");
      return;
    }
    output?.appendLine(
      `Проверка обновлений: текущая версия ${currentVersion}, последний релиз ${release.version} (${release.label})`
    );
    if (!isNewerRelease(currentVersion, release.version)) return;

    const action = await vscode.window.showInformationMessage(
      `Доступно обновление MCU-NR Helper: ${currentVersion} -> ${release.version}.`,
      "Открыть релизы"
    );
    if (action === "Открыть релизы") {
      await vscode.env.openExternal(vscode.Uri.parse(release.url));
    }
  } catch (error) {
    output?.appendLine(
      `Проверка обновлений: пропущена (${error instanceof Error ? error.message : String(error)})`
    );
  }
}
