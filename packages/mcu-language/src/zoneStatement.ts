/** Зона с булевым выражением и хвостом /reg:mat — даже если имя совпадает с меткой справочника (GRBL, ZRTB…). */
export function looksLikeZoneStatement(text: string): boolean {
  const t = text.trim();
  if (/^(PARM|LISTEL|LATT|LFIXSO|LBLACK|BOUN|ROOT|NORM|FUNC)\s/i.test(t)) return false;
  if (/^(EQU|SET)\s/i.test(t)) return false;
  if (/^(EQU|SET)\s+\w+\s*=/i.test(t)) return false;
  if (/\s=\s/.test(t)) return false;
  if (hasZoneRegistrationTail(t)) return true;
  const m = t.match(/^[A-Za-z][A-Za-z0-9]{0,5}\s+(.+)/);
  if (!m) return false;
  let rest = m[1].replace(/;.*/, "").trim();
  const slashPos = rest.search(/\s+\/(?:-\d+|\d)/);
  if (slashPos >= 0) rest = rest.slice(0, slashPos).trim();
  if (/[*()]|\b(?:COS|SIN|TAN|SQRT|LN)\b/i.test(rest)) return false;
  if (/\d+\s*-\s*\d+/.test(rest)) return true;
  if (/\bU\b/.test(rest)) return true;
  if (/-\s*[A-Za-z][A-Za-z0-9]{0,5}/.test(rest)) return true;
  if (/^\d+$/.test(rest)) return true;
  return false;
}

/** Хвост регистрации/материала зоны (#M=…, /reg:mat, :mat). */
export function hasZoneRegistrationTail(text: string): boolean {
  return /(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/.test(text);
}

/**
 * Сильный признак зоны при конфликте с картой другого фрагмента (GRBL … /1:2).
 * Не срабатывает на `NPS 1` / `PROB 1` — это карты источника, не зоны.
 */
export function looksLikeZoneOverridingFragment(text: string): boolean {
  const t = text.trim();
  if (hasZoneRegistrationTail(t)) return true;
  const m = t.match(/^[A-Za-z][A-Za-z0-9]{0,5}\s+(.+)/);
  if (!m) return false;
  let rest = m[1].replace(/;.*/, "").trim();
  const slashPos = rest.search(/\s+\/(?:-\d+|\d)/);
  if (slashPos >= 0) rest = rest.slice(0, slashPos).trim();
  if (/[*()]|\b(?:COS|SIN|TAN|SQRT|LN)\b/i.test(rest)) return false;
  if (/\d+\s*-\s*\d+/.test(rest)) return true;
  if (/\bU\b/.test(rest)) return true;
  if (/-\s*[A-Za-z][A-Za-z0-9]{0,5}/.test(rest)) return true;
  return false;
}

/** Генератор G2MP: после PARM идёт картограмма строк L01…LJ (UserGuide §9.2.6.3). */
export function latticeTypeUsesCartogram(latticeType: string): boolean {
  return latticeType.toUpperCase().replace(/\s+/g, "") === "G2MP";
}

/** Строка картограммы G2MP: метка L + номер строки (L01, L02, …, L10, L23). */
export function isG2mpCartogramRow(label: string): boolean {
  return /^L\d{2,}$/i.test(label);
}
