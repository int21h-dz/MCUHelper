/**
 * Омоним SI: карта суммарного изотопа (UserGuide §8.5) vs нуклид кремния в MATR.
 *
 * ⚠ АГЕНТАМ — НЕ СМЕШИВАТЬ:
 * - Карта: `SI list` / `SI` (пусто) / `SI FP1 AM241` — keyword карты, суммарный изотоп.
 * - Нуклид: `SI dens` (`SI 1.1E-2`, `SI 0.04`, …) — кремний в составе MATR, как U235/ZR.
 * - TextMate: в `mcunr.tmLanguage.json` SI карты — ОТДЕЛЬНОЕ правило с lookahead dens;
 *   не возвращать SI в общий `|SI|` списка cards (иначе кремний красится как карта).
 * - Decorations (`sumIsotopeDecorations.ts`): не серить заголовок карты SI list;
 *   `SI dens` — обычная строка состава, её можно красить.
 * - sumIsotope / hover / signature: применять логику карты SI только если
 *   `isSiSumIsotopeCardLine(text) === true`.
 *
 * SINOT/SIDEN/SIPRN — не омонимы состава, всегда карты.
 */

const DENSITY_RE = /^[\d.Ee+-]+$/;

/** dens-токен нуклида: число / sci / выражение, начинающееся с цифры/знака/`(`. */
export function looksLikeNuclideDensToken(token: string): boolean {
  if (DENSITY_RE.test(token)) return true;
  return /^[+\-.(0-9]/.test(token);
}

/**
 * Префикс строки — карта SI list (не кремний).
 * `SI FP1` / `SI` → true; `SI 1.1E-2` → false.
 * EQU-имя как dens (`SI CONC`) ошибочно уйдёт в карту — редкий кейс.
 */
export function isSiCardListPrefix(tokens: string[]): boolean {
  if (tokens[0]?.toUpperCase() !== "SI") return false;
  if (tokens.length === 1) return true;
  return !looksLikeNuclideDensToken(tokens[1]!);
}

/**
 * Полная строка — карта суммарного изотопа SI (не нуклид кремния).
 * Комментарий `;…` отрезается; разделители списка — пробел и запятая.
 */
export function isSiSumIsotopeCardLine(text: string): boolean {
  const code = text.replace(/;.*/, "").trim();
  if (!code) return false;
  const tokens = code.split(/[\s,]+/).filter(Boolean);
  return isSiCardListPrefix(tokens);
}

/** Строка карты SI/SINOT/SIDEN (для decorations / hover). `SI dens` — false. */
export function isSumIsotopeCardLine(text: string): boolean {
  const code = text.replace(/;.*/, "").trim();
  if (!code) return false;
  const parts = code.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const head = parts[0]!.toUpperCase();
  if (head === "SINOT" || head === "SIDEN") return true;
  if (head !== "SI") return false;
  return isSiSumIsotopeCardLine(code);
}
