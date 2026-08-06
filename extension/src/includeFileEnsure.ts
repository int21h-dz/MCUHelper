import * as fs from "fs";
import * as path from "path";

/** Создаёт пустой include-файл, если его ещё нет (каталоги — рекурсивно). */
export async function ensureIncludeFileExists(fsPath: string): Promise<boolean> {
  try {
    if (fs.existsSync(fsPath)) {
      return fs.statSync(fsPath).isFile();
    }
    await fs.promises.mkdir(path.dirname(fsPath), { recursive: true });
    await fs.promises.writeFile(fsPath, "", "utf8");
    return true;
  } catch {
    return false;
  }
}
