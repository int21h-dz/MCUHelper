/**
 * Разворачивает токены картограммы NET: `56*1` → пятьдесят шесть «1»,
 * обычное число остаётся как есть. Предел повторов — защита от гигантских массивов.
 */
const MAX_CART_REPEAT = 10_000;

export function expandCartogramToken(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const m = t.match(/^(\d+)\*([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)$/);
  if (m) {
    const count = parseInt(m[1]!, 10);
    if (!Number.isFinite(count) || count < 0) return [t];
    if (count > MAX_CART_REPEAT) return Array(MAX_CART_REPEAT).fill(m[2]!);
    return Array(count).fill(m[2]!);
  }
  return [t];
}

export function expandCartogramTokens(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of raw) out.push(...expandCartogramToken(t));
  return out;
}

/** Уникальные материальные номера из развёрнутой картограммы M**. */
export function uniqueMaterialNumsFromCartogram(raw: readonly string[]): number[] {
  const set = new Set<number>();
  for (const t of expandCartogramTokens(raw)) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}
