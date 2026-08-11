/**
 * Генерация секции регистрации типа N внутри RGS.
 */

export interface RegistrationBuilderInput {
  ptype: 1 | 2 | 3;
  ttype?: 0 | 1 | 2;
  materials?: number[];
  zones?: number[];
  objects?: number[];
  /** Нижние границы ENERGY (эВ), 0 должно быть явно */
  energy?: number[];
  reactions?: number[];
  includeFlux?: boolean;
  includeReactions?: boolean;
}

function formatList(nums: number[]): string {
  return [...new Set(nums)].sort((a, b) => a - b).join(", ");
}

/** Собрать блок PTYPE…END. */
export function buildRegistrationSection(input: RegistrationBuilderInput): {
  text: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines: string[] = [`PTYPE ${input.ptype}`];
  if (input.ttype !== undefined) {
    lines.push(`TTYPE ${input.ttype}`);
  }

  const mats = input.materials ?? [];
  const zones = input.zones ?? [];
  const objs = input.objects ?? [];
  if (!mats.length && !zones.length && !objs.length) {
    warnings.push("Не выбраны области регистрации (материалы/зоны/объекты).");
  }

  const wantFlux = input.includeFlux !== false;
  const wantRct = !!input.includeReactions || !!(input.reactions && input.reactions.length);

  if (wantFlux) {
    if (mats.length) lines.push(`MFLU ${formatList(mats)}`);
    if (zones.length) lines.push(`ZFLU ${formatList(zones)}`);
    if (objs.length) lines.push(`OFLU ${formatList(objs)}`);
  }
  if (wantRct) {
    if (mats.length) lines.push(`MRCT ${formatList(mats)}`);
    if (zones.length) lines.push(`ZRCT ${formatList(zones)}`);
    if (objs.length) lines.push(`ORCT ${formatList(objs)}`);
    const rct = input.reactions?.length ? input.reactions : [1];
    lines.push(`RCT ${formatList(rct)}`);
  }

  const energy = input.energy?.length ? input.energy : [0];
  if (!energy.includes(0)) {
    warnings.push("В ENERGY добавлен 0 (требуется явно).");
    energy.unshift(0);
  }
  lines.push(`ENERGY ${energy.join(", ")}`);
  lines.push("END");

  return { text: lines.join("\n") + "\n", warnings };
}

/** Найти строку вставки: после RGS/REGD/REG или перед FINISH регистрации. */
export function findRegistrationInsertLine(text: string): number | undefined {
  const lines = text.split(/\r?\n/);
  let rgs = -1;
  let finish = -1;
  for (let i = 0; i < lines.length; i++) {
    const lab = lines[i]!.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    if (lab === "RGS" || lab === "REGD" || lab === "REG") {
      if (rgs < 0) rgs = i;
    }
    if (rgs >= 0 && lab === "FINISH" && finish < 0) {
      finish = i;
      break;
    }
  }
  if (rgs < 0) return undefined;
  return finish >= 0 ? finish : rgs + 1;
}
