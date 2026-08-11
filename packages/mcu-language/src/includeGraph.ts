/**
 * Плоский граф зависимостей `#include`: main → includes.
 * Вложенные `#include` в MCU запрещены (ошибка препроцессора) — в граф как узлы не добавляются.
 */

import { parseIncludeLine } from "./includeResolve";

export interface IncludeGraphNode {
  /** Путь как в директиве `#include`. */
  path: string;
  uri?: string;
  fsPath?: string;
  exists: boolean;
  /** Автоопределённая кодировка файла (utf8 / win1251 / …). */
  encoding?: string;
  /** Число диагностик, относящихся к этому include. */
  diagCount?: number;
  /** 0-based строка директивы в main. */
  mainLine: number;
  /** В файле обнаружен вложенный `#include` (уже error в препроцессоре). */
  nestedInclude?: boolean;
}

export interface IncludeGraphSource {
  path: string;
  uri?: string;
  fsPath?: string;
  /** По умолчанию false, если не передано. */
  exists?: boolean;
  mainLine: number;
  encoding?: string;
  diagCount?: number;
  /** Явный флаг вложенности (из диагностик expand). */
  nestedInclude?: boolean;
  /** Текст include — для детекта вложенности без I/O. */
  text?: string;
}

/** Есть ли в тексте директива `#include` (вложенность запрещена MCU). */
export function includeTextHasNestedInclude(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (parseIncludeLine(line)) return true;
  }
  return false;
}

/**
 * Собирает узлы графа из директив main (порядок появления).
 * Чистая функция: без fs / LSP — encoding и diagCount передаёт вызывающий.
 */
export function buildIncludeGraph(sources: IncludeGraphSource[]): IncludeGraphNode[] {
  return sources.map((s) => {
    const nested =
      s.nestedInclude === true || (s.text != null && includeTextHasNestedInclude(s.text));
    const node: IncludeGraphNode = {
      path: s.path,
      exists: s.exists === true,
      mainLine: s.mainLine,
    };
    if (s.uri) node.uri = s.uri;
    if (s.fsPath) node.fsPath = s.fsPath;
    if (s.encoding) node.encoding = s.encoding;
    if (s.diagCount != null) node.diagCount = s.diagCount;
    if (nested) node.nestedInclude = true;
    return node;
  });
}
