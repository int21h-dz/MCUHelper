import { pathToFileURL } from "url";
import { readTextFileWithDetectedEncoding } from "./encodingDetect";

import type { IncludeLineMapEntry } from "./ast";
import { normalizeIncludeFsKey, parseIncludeLine, resolveIncludeFilePath, textHasIncludeDirective } from "./includeResolve";

export interface IncludeExpandError {
  message: string;
  includePath: string;
  mainLine: number;
}

export interface ExpandIncludesResult {
  text: string;
  includes: string[];
  errors: IncludeExpandError[];
  lineMap: IncludeLineMapEntry[];
}

export type IncludeTextOverrides = ReadonlyMap<string, string>;

function readIncludeText(fsPath: string, overrides?: IncludeTextOverrides): string {
  const fromBuf = overrides?.get(normalizeIncludeFsKey(fsPath));
  if (fromBuf != null) return fromBuf;
  return readTextFileWithDetectedEncoding(fsPath);
}

/**
 * @param includeTextOverrides — открытые в LSP буферы include (ключ = normalizeIncludeFsKey(fsPath)).
 *   Без этого правка SI в include до Save невидима родителю (чтение только с диска).
 */
export function expandIncludes(
  text: string,
  baseDir: string,
  includeTextOverrides?: IncludeTextOverrides
): ExpandIncludesResult {
  const includes: string[] = [];
  const errors: IncludeExpandError[] = [];

  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const lineMap: IncludeLineMapEntry[] = [];

  for (let mainLine = 0; mainLine < lines.length; mainLine++) {
    const line = lines[mainLine]!;
    const parsed = parseIncludeLine(line);
    if (parsed) {
      const incPath = parsed.path;
      includes.push(incPath);
      const { fsPath, exists } = resolveIncludeFilePath(baseDir, incPath);
      const includeUri = pathToFileURL(fsPath).href;
      try {
        if (!exists && includeTextOverrides?.get(normalizeIncludeFsKey(fsPath)) == null) {
          errors.push({ message: `Файл include не найден: ${incPath}`, includePath: incPath, mainLine });
          out.push(line);
          lineMap.push({ source: "main", mainLine });
          continue;
        }
        const incText = readIncludeText(fsPath, includeTextOverrides);
        if (textHasIncludeDirective(incText)) {
          errors.push({ message: `Вложенный #include запрещён: ${incPath}`, includePath: incPath, mainLine });
        }
        out.push(`* --- included from ${incPath} ---`);
        lineMap.push({
          source: "marker",
          mainLine,
          mainIncludeLine: mainLine,
          includePath: incPath,
          includeFsPath: fsPath,
          includeUri,
        });
        out.push(incText);
        const includeLines = incText.split(/\r?\n/);
        for (let includeLine = 0; includeLine < includeLines.length; includeLine++) {
          lineMap.push({
            source: "include",
            mainLine,
            mainIncludeLine: mainLine,
            includePath: incPath,
            includeFsPath: fsPath,
            includeUri,
            includeLine,
          });
        }
        out.push(`* --- end include ${incPath} ---`);
        lineMap.push({
          source: "marker",
          mainLine,
          mainIncludeLine: mainLine,
          includePath: incPath,
          includeFsPath: fsPath,
          includeUri,
        });
      } catch (e) {
        errors.push({ message: `Ошибка чтения include ${incPath}: ${e}`, includePath: incPath, mainLine });
        out.push(line);
        lineMap.push({ source: "main", mainLine });
      }
    } else {
      out.push(line);
      lineMap.push({ source: "main", mainLine });
    }
  }

  return { text: out.join("\n"), includes, errors, lineMap };
}

export function expandRepeats(text: string): string {
  return text.replace(/\[(\d+)\|([^\]]*)\]/g, (_, n: string, val: string) => {
    const count = parseInt(n, 10);
    if (count <= 0) return "";
    return val.repeat(count);
  });
}
