import type { BodySummary, ConstantSummary, DocumentAst, DiagnosticMessage, LatticeSummary, MaterialSummary, NetSummary, ObjectSummary, ZoneSummary } from "./ast";
export declare function analyzeSemantics(ast: DocumentAst): DiagnosticMessage[];
export declare function buildConstantSummaries(ast: DocumentAst): ConstantSummary[];
export declare function buildSummaries(ast: DocumentAst): {
    materials: MaterialSummary[];
    zones: ZoneSummary[];
    objects: ObjectSummary[];
    constants: ConstantSummary[];
    bodies: BodySummary[];
    nets: NetSummary[];
    lattices: LatticeSummary[];
};
