import * as fs from "fs";
import * as path from "path";

export function expandIncludes(text: string, baseDir: string): { text: string; includes: string[]; errors: string[] } {
  const includes: string[] = [];
  const errors: string[] = [];
  const includeRe = /^#include\s+<([^>]+)>/im;

  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(includeRe);
    if (m && line.trimStart().startsWith("#")) {
      const incPath = m[1];
      includes.push(incPath);
      const full = path.isAbsolute(incPath) ? incPath : path.join(baseDir, incPath);
      try {
        if (!fs.existsSync(full)) {
          errors.push(`Файл include не найден: ${incPath}`);
          out.push(line);
          continue;
        }
        const incText = fs.readFileSync(full, "utf8");
        if (/#include\s+</i.test(incText)) {
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
