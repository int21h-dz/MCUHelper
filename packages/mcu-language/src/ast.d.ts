export type FragmentId = "physical" | "geometry" | "source" | "registration" | "burnupRegistration" | "trajectory" | "calculationControl" | "burnup";
export interface SourceRange {
    start: {
        line: number;
        character: number;
    };
    end: {
        line: number;
        character: number;
    };
    offset: number;
    endOffset: number;
}
export interface DiagnosticMessage {
    severity: "error" | "warning" | "info";
    message: string;
    range: SourceRange;
    code?: string;
}
export interface NuclideEntry {
    name: string;
    density: string;
    mods?: string;
    ace?: string;
    range: SourceRange;
}
export interface MaterialNode {
    kind: "material";
    number: number;
    label: string;
    temperature?: number;
    group?: string;
    nameLib?: string;
    densParam?: string;
    /** Значение DENSAA/DENSWA/DENSAW/DENSWW с карты MATR. */
    densValue?: number;
    nuclides: NuclideEntry[];
    range: SourceRange;
}
export interface BodyNode {
    kind: "body";
    bodyType: string;
    name: string;
    params: string[];
    range: SourceRange;
    scope?: string;
    transf?: boolean;
    protoName?: string;
}
export interface ZoneTailLegacy {
    kind: "legacy";
    reg?: number;
    mat?: number;
    obj?: number;
    bcType?: string;
    /** :mat или /:mat — reg=1, obj по умолчанию 1 (UserGuide §9.1.4). */
    defaultRegObj?: boolean;
    /** /reg[/obj] без mat — материал из предыдущей зоны с тем же reg. */
    inheritMat?: boolean;
}
export interface ZoneTailHash {
    kind: "hash";
    m?: number;
    z?: number;
    o?: number;
    im?: number;
    iz?: number;
    io?: number;
    g?: string;
}
export interface ZoneNode {
    kind: "zone";
    name: string;
    expression: string;
    searchType?: string;
    netCarrier?: string;
    scope?: string;
    tail: ZoneTailLegacy | ZoneTailHash | null;
    range: SourceRange;
}
export interface ConstantNode {
    kind: "constant";
    name: string;
    expression: string;
    mutable: boolean;
    /** global | cell:NAME | lcell:NAME — прототип сети/решётки */
    scope?: string;
    range: SourceRange;
}
export interface CellPrototypeNode {
    kind: "cell";
    name: string;
    extend: boolean;
    bodies: BodyNode[];
    zones: ZoneNode[];
    lattices: LatticeNode[];
    range: SourceRange;
}
export interface NetNode {
    kind: "net";
    name: string;
    root: string;
    cols: number;
    rows: number;
    layers?: number;
    typeMap: string[][];
    regMaps?: string[][][];
    objMaps?: string[][][];
    matMaps?: string[][][];
    range: SourceRange;
}
export interface LatticeElementNode {
    kind: "lcell";
    name: string;
    bodies: BodyNode[];
    zones: ZoneNode[];
    nets: NetNode[];
    range: SourceRange;
}
export interface LatticeNode {
    kind: "lattice";
    latticeType: string;
    /** @deprecated используйте zoneNames */
    zoneName: string;
    /** Зоны-носители решётки (глобальные). */
    zoneNames: string[];
    elements: string[];
    /** Строки PARM (сырой текст после метки). */
    positions: string[];
    range: SourceRange;
}
export interface IncludeNode {
    kind: "include";
    path: string;
    fsPath?: string;
    uri?: string;
    exists?: boolean;
    range: SourceRange;
}
export interface IncludeLineMapEntry {
    source: "main" | "include" | "marker";
    mainLine: number;
    mainIncludeLine?: number;
    includePath?: string;
    includeFsPath?: string;
    includeUri?: string;
    includeLine?: number;
}
export interface StatementNode {
    kind: "statement";
    label: string;
    text: string;
    range: SourceRange;
    fragment: FragmentId;
}
export interface DocumentAst {
    uri: string;
    statements: StatementNode[];
    materials: MaterialNode[];
    bodies: BodyNode[];
    zones: ZoneNode[];
    constants: ConstantNode[];
    cells: CellPrototypeNode[];
    nets: NetNode[];
    latticeElements: LatticeElementNode[];
    lattices: LatticeNode[];
    includes: IncludeNode[];
    includeLineMap?: IncludeLineMapEntry[];
    fragments: FragmentSpan[];
    diagnostics: DiagnosticMessage[];
    cameraPresets: CameraPreset[];
}
export interface FragmentSpan {
    id: FragmentId;
    startLine: number;
    endLine: number;
}
export interface CameraPreset {
    name: string;
    left: [number, number, number];
    right: [number, number, number];
    dir: [number, number, number];
    line: number;
}
export interface MaterialSummary {
    number: number;
    group?: string;
    temperature?: number;
    nuclideCount: number;
    /** Сколько нуклидов реально пошло в расчёт ρ текущего материала. */
    usedNuclideCount: number;
    /** Сколько нуклидов входят в суммарный изотоп (SI/SINOT/SIDEN). */
    sumIsotopeCount: number;
    /** Из sum-isotope: сколько нуклидов есть в AW.LIB и грубо учтены в ρ. */
    sumIsotopeUsedCount: number;
    /** Из sum-isotope: сколько нуклидов отсутствуют в AW.LIB и не учтены по банку. */
    sumIsotopeMissingAwLibCount: number;
    nuclidesPreview: string;
    massDensityGcm3: number | null;
    volumeCm3: number | null;
    massG: number | null;
    nuclides: Array<{
        name: string;
        concentration: string;
        range: SourceRange;
        /** Нуклид входит в суммарный изотоп (SI/SINOT/SIDEN, UserGuide §8.5). */
        sumIsotope?: {
            reasons: string[];
            /** Есть ли запись нуклида в AW.LIB; undefined если AW.LIB не загружена. */
            inAwLib?: boolean;
        };
    }>;
    range: SourceRange;
}
export interface ZoneSummary {
    name: string;
    expression: string;
    materialNum?: number;
    regNum?: number;
    objNum?: number;
    range: SourceRange;
}
export interface ObjectSummary {
    objectNum: number;
    zoneNames: string[];
    materialNums: number[];
}
export interface ConstantSummary {
    name: string;
    expression: string;
    value: number | null;
    mutable: boolean;
    scope?: string;
    range: SourceRange;
    /** URI файла определения (main или `#include`); задаёт getIndex для клика в панели. */
    uri?: string;
}
export interface BodySummary {
    name: string;
    bodyType: string;
    paramsPreview: string;
    /** Аналитический объём тела (см³), если тип поддерживается. */
    volumeCm3?: number | null;
    scope?: string;
    transf?: boolean;
    protoName?: string;
    range: SourceRange;
}
export interface NetCartogramRowSummary {
    row: number;
    label: string;
    prototypes: string[];
}
export interface NetSummary {
    name: string;
    root: string;
    cols: number;
    rows: number;
    layers?: number;
    typeMapRowCount: number;
    cartogram: NetCartogramRowSummary[];
    carrierZones: Array<{
        name: string;
        range: SourceRange;
    }>;
    prototypes: Array<{
        name: string;
        range?: SourceRange;
    }>;
    range: SourceRange;
}
export interface LatticeSummary {
    latticeType: string;
    zoneNames: string[];
    elements: Array<{
        name: string;
        range?: SourceRange;
    }>;
    positionsPreview: string;
    range: SourceRange;
}
