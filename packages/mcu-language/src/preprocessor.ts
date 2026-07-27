import * as fs from "fs";
import { parseIncludeLine, resolveIncludeFilePath } from "./includeResolve";

export function expandIncludes(text: string, baseDir: string): { text: string; includes: string[]; errors: string[] } {
  const includes: string[] = [];
  const errors: string[] = [];

  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const parsed = parseIncludeLine(line);
    if (parsed) {
      const incPath = parsed.path;
      includes.push(incPath);
      const { fsPath, exists } = resolveIncludeFilePath(baseDir, incPath);
      try {
        if (!exists) {
          errors.push(`Файл include не найден: ${incPath}`);
          out.push(line);
          continue;
        }
        const incText = fs.readFileSync(fsPath, "utf8");
        if (/#include\s+(?:<|\S)/i.test(incText)) {
          errors.push(`Вложенный #include запрещён: ${incPath}`);
        }
        out.push(`* --- included from ${incPath} ---`);
        out.push(incText);
        out.push(`* --- end include ${incPath} ---`);
      } catch (e) {
        errors.push(`Ошибка чтения include ${incPath}: ${e}`);
        out.push(line);
      }
    } else {
      out.push(line);
    }
  }

  return { text: out.join("\n"), includes, errors };
}

export function expandRepeats(text: string): string {
  return text.replace(/\[(\d+)\|([^\]]*)\]/g, (_, n: string, val: string) => {
    const count = parseInt(n, 10);
    if (count <= 0) return "";
    return val.repeat(count);
  });
}
