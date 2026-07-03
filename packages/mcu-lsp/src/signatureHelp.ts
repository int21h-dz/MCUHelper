import type { ParameterSignatureHelp } from "@mcuhelper/mcu-language";
import { getParameterSignatureHelp } from "@mcuhelper/mcu-language";
import type { Position } from "vscode-languageserver";
import type { SignatureHelp, SignatureInformation } from "vscode-languageserver";

export function getSignatureHelp(
  doc: { getText: (r: { start: { line: number; character: number }; end: Position }) => string },
  pos: Position
): SignatureHelp | null {
  const fullLine = doc.getText({
    start: { line: pos.line, character: 0 },
    end: { line: pos.line, character: 1_000 },
  });

  const info: ParameterSignatureHelp | null = getParameterSignatureHelp(fullLine, pos.character);
  if (!info || !info.parameters.length) return null;

  const sig: SignatureInformation = {
    label: info.label,
    documentation: info.documentation,
    parameters: info.parameters.map((p) => ({
      label: p.label,
      documentation: p.documentation,
    })),
  };

  return {
    signatures: [sig],
    activeSignature: 0,
    activeParameter: info.activeParameter,
  };
}
