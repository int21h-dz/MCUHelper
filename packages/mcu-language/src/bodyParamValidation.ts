import type { BodyNode, DiagnosticMessage, DocumentAst } from "./ast";
import { getBodyParamCount } from "./constants";
import { getBodyParamGroups } from "./schemaBridge";

function tokensAfterBodyKeyword(text: string, bodyType: string): string[] {
  const parts = text.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const u = bodyType.toUpperCase();
  if (parts[0].toUpperCase() === u) return parts.slice(1);
  if (parts.length > 1 && parts[1].toUpperCase() === u) return parts.slice(2);
  return [];
}

/**
 * Максимум фрагментов после метки тела (имя + числовые/выражения).
 * UserGuide §7.1 / §9.1.3: разделители — пробелы и/или запятые; запятая не обязательна.
 * Считаем токены по пробелам; `0,0,0` — один фрагмент.
 */
function maxBodyArgs(bodyType: string): number | null {
  const upper = bodyType.toUpperCase();
  const numerics = getBodyParamCount(upper);
  if (numerics === "var") return null;
  if (typeof numerics === "number") return numerics + 1;
  const groups = getBodyParamGroups(upper)?.length ?? 0;
  return groups || null;
}

function formatExpectedParams(bodyType: string): string {
  const groups = getBodyParamGroups(bodyType);
  const numerics = getBodyParamCount(bodyType);
  if (typeof numerics === "number") {
    const labels = groups?.map((g) => g.label).join(", ");
    return labels
      ? `${numerics + 1} (name + ${numerics} полей: ${labels})`
      : `${numerics + 1} (name + ${numerics} чисел)`;
  }
  if (groups?.length) return groups.map((g) => g.label).join(", ");
  return "";
}

export function validateBodyArgCount(body: BodyNode, stmtText: string): DiagnosticMessage | null {
  const max = maxBodyArgs(body.bodyType);
  if (max === null) return null;

  const actual = tokensAfterBodyKeyword(stmtText, body.bodyType);
  if (actual.length <= max) return null;

  return {
    severity: "error",
    message: `${body.bodyType} ${body.name}: лишние параметры — ожидается не более ${max} (${formatExpectedParams(body.bodyType)}), введено ${actual.length}`,
    code: "body-params-extra",
    range: body.range,
  };
}

export function analyzeBodyParameterCounts(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const stmtByLine = new Map<number, string>();
  for (const s of ast.statements) {
    stmtByLine.set(s.range.start.line, s.text);
  }

  for (const b of ast.bodies) {
    if (b.bodyType === "TRANSF") continue;
    const text = stmtByLine.get(b.range.start.line) ?? "";

    const extra = validateBodyArgCount(b, text);
    if (extra) diags.push(extra);
  }

  return diags;
}
