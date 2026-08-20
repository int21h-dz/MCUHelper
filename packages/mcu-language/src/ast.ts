export type FragmentId =
  | "physical"
  | "geometry"
  | "source"
  | "registration"
  | "burnupRegistration"
  | "trajectory"
  | "calculationControl"
  | "burnup";

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
  offset: number;
  endOffset: number;
}

export interface DiagnosticRelated {
  message: string;
  range: SourceRange;
}

export interface DiagnosticMessage {
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
  code?: string;
  /** Доп. места (первое определение и т.п.) — в expanded-координатах, как `range`. */
  related?: DiagnosticRelated[];
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
  /** UserGuide §9.1.3.22: M — отражение, R — поворот. */
  transfMode?: string;
}

export interface ZoneTailLegacy {
  kind: "legacy";
  /**
   * Рег. номер: положительный = безусловный; отрицательный = УРУ (−|n|).
   * UserGuide §9.1.4.
   */
  reg?: number;
  /**
   * Материальный номер: положительный = безусловный; отрицательный = УМУ (−|n|).
   */
  mat?: number;
  /**
   * Объектный номер: положительный = безусловный; отрицательный = УОУ (−|n|).
   */
  obj?: number;
  bcType?: string;
  /** :mat или /:mat — reg=1, obj по умолчанию 1 (UserGuide §9.1.4). */
  defaultRegObj?: boolean;
  /** /reg[/obj] без mat — материал из предыдущей зоны с тем же reg (только absolute reg). */
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

/**
 * Строка картограммы NET P/O/M (UserGuide §9.2.3).
 * Метка `P<kk><jj>`: kk = номер условного указателя, jj = номер строки сети.
 */
export interface NetCartogramRow {
  label: string;
  /** Номер условного указателя (УРУ/УОУ/УМУ), 1-based. */
  pointerIndex: number;
  /** Номер строки сети j (1-based); отсутствует при ALL. */
  rowIndex?: number;
  /** Номер слоя k (1-based) для LAY-форм. */
  layer?: number;
  /** `PkkALL` / `OkkALL` / `MkkALL` — одно значение на всю сетку. */
  all?: boolean;
  /** Развёрнутые значения строки (или одно значение при all). */
  values: string[];
}

export interface NetNode {
  kind: "net";
  name: string;
  root: string;
  cols: number;
  rows: number;
  layers?: number;
  typeMap: string[][];
  /** @deprecated используйте regCartogram */
  regMaps?: string[][][];
  /** @deprecated используйте objCartogram */
  objMaps?: string[][][];
  /** @deprecated используйте matCartogram */
  matMaps?: string[][][];
  /** Картограммы регистрационных номеров (P**). */
  regCartogram?: NetCartogramRow[];
  /** Картограммы объектных номеров (O**). */
  objCartogram?: NetCartogramRow[];
  /** Картограммы материальных номеров (M**). */
  matCartogram?: NetCartogramRow[];
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
  /** Картограмма прототипов G2MP (строки L01… после PARM). */
  typeMap?: string[][];
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
  /** Σ удельной активности a_V/ρ (Бк/г); null если нет ρ или активности. */
  activityBqPerG: number | null;
  nuclides: Array<{
    name: string;
    concentration: string;
    range: SourceRange;
    /** URI файла нуклида (main или `#include`), если отличается от MATR. */
    uri?: string;
    /** Нуклид входит в суммарный изотоп (SI/SINOT/SIDEN, UserGuide §8.5). */
    sumIsotope?: {
      reasons: string[];
      /** Есть ли запись нуклида в AW.LIB; undefined если AW.LIB не загружена. */
      inAwLib?: boolean;
    };
  }>;
  range: SourceRange;
  /** URI файла MATR (main или `#include`); задаёт getIndex для CodeLens. */
  uri?: string;
}

export interface ZoneSummary {
  name: string;
  expression: string;
  materialNum?: number;
  regNum?: number;
  objNum?: number;
  /** УРУ (1-based), если рег. указатель условный. */
  regPointerIndex?: number;
  /** УОУ (1-based), если объектный указатель условный. */
  objPointerIndex?: number;
  /** УМУ (1-based), если материальный указатель условный. */
  matPointerIndex?: number;
  /** Хотя бы один из указателей условный. */
  hasConditionalPointers?: boolean;
  range: SourceRange;
  /** URI файла зоны (main или `#include`). */
  uri?: string;
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
  transfMode?: string;
  range: SourceRange;
  /** URI файла тела (main или `#include`). */
  uri?: string;
}

export interface NetCartogramRowSummary {
  row: number;
  label: string;
  prototypes: string[];
}

export interface NetPointerCartogramSummary {
  pointerIndex: number;
  label: string;
  rowIndex?: number;
  layer?: number;
  all?: boolean;
  valuesPreview: string;
}

export interface NetSummary {
  name: string;
  root: string;
  cols: number;
  rows: number;
  layers?: number;
  typeMapRowCount: number;
  cartogram: NetCartogramRowSummary[];
  /** Картограммы P** (рег. номера для УРУ). */
  regCartogram?: NetPointerCartogramSummary[];
  /** Картограммы O** (объектные номера для УОУ). */
  objCartogram?: NetPointerCartogramSummary[];
  /** Картограммы M** (материалы для УМУ). */
  matCartogram?: NetPointerCartogramSummary[];
  carrierZones: Array<{ name: string; range: SourceRange; uri?: string }>;
  prototypes: Array<{ name: string; range?: SourceRange; uri?: string }>;
  range: SourceRange;
  /** URI файла NET (main или `#include`). */
  uri?: string;
}

export interface LatticeSummary {
  latticeType: string;
  zoneNames: string[];
  elements: Array<{ name: string; range?: SourceRange; uri?: string }>;
  positionsPreview: string;
  range: SourceRange;
  /** URI файла LATT (main или `#include`). */
  uri?: string;
}
