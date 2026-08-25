import * as path from "path";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import {
  loadBodyArrayGeneratorApi,
  loadBodyGeneratorApi,
  type BodyGeneratorInput,
  type BodyTypeOption,
} from "./mcuLanguageBridge";
import {
  loadSliceVisibility,
  parseSliceVisibilityMessage,
  saveSliceVisibility,
} from "./sliceViewVisibility";

type VisibleConstant = {
  name: string;
  expression: string;
  value: number | null;
  mutable: boolean;
  scope: string;
};

type PatternState = {
  group: "none" | "array" | "curve" | "mirror";
  mode: string;
  values: Record<string, number | string>;
  excludedIndices?: number[];
};

type FormState = {
  bodyType: string;
  name: string;
  params: string[];
  pattern?: PatternState;
};

type GeometrySceneLike = {
  primitives?: Array<{
    type: string;
    name: string;
    params: number[];
    bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    color?: string;
  }>;
  bbox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

type MeshPreviewApi = {
  buildDraftBodyPreview: (input: {
    bodyType: string;
    name: string;
    params: number[];
    scenePrimitives: NonNullable<GeometrySceneLike["primitives"]>;
    sceneBbox?: GeometrySceneLike["bbox"];
    nearby?: { maxCount?: number; maxGapFactor?: number; excludeName?: string };
    extraBodies?: Array<{ name: string; bodyType: string; params: number[]; excluded?: boolean }>;
    slicePositions?: Partial<{ x: number; y: number; z: number }>;
    transf?: { protoName: string; mode: string; A: number; B: number; f: number };
  }) => {
    meshes: unknown[];
    focusName: string;
    neighborNames: string[];
    nearest?: { name: string; gap: number };
    bbox: GeometrySceneLike["bbox"] | null;
    focusBbox?: GeometrySceneLike["bbox"] | null;
    unsupported: boolean;
    warnings: string[];
    slices?: Array<{
      axis: string;
      title: string;
      position: number;
      uLabel: string;
      vLabel: string;
      bounds: { uMin: number; uMax: number; vMin: number; vMax: number };
      polylines: Array<{
        points: Array<{ u: number; v: number }>;
        closed: boolean;
        color: string;
        highlight: boolean;
        name: string;
      }>;
    }>;
  };
  translateBodyParams: (bodyType: string, params: number[], dx: number, dy: number, dz: number) => number[] | null;
  applyTransfToBodyParams: (
    bodyType: string,
    params: number[],
    mode: "M" | "R",
    A: number,
    B: number,
    f: number
  ) => number[] | null;
  bodyAnchorPoint: (bodyType: string, params: number[]) => { x: number; y: number; z: number } | null;
};

function loadMeshPreviewApi(): MeshPreviewApi | null {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-geometry", "meshPreview.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-geometry", "dist", "meshPreview.js"),
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(candidate) as MeshPreviewApi;
    } catch {
      /* try next */
    }
  }
  return null;
}

const DEFAULT_PATTERN: PatternState = {
  group: "none",
  mode: "linear",
  excludedIndices: [],
  values: {
    count: 3,
    stepMode: "vector",
    sx: 2,
    sy: 0,
    sz: 0,
    length: 2,
    dirX: 1,
    dirY: 0,
    dirZ: 0,
    n1: 2,
    n2: 3,
    ux: 2,
    uy: 0,
    uz: 0,
    vx: 0,
    vy: 2,
    vz: 0,
    rings: 1,
    pitch: 2,
    x0: 0,
    y0: 0,
    z0: 0,
    x1: 6,
    y1: 0,
    z1: 0,
    cx: 0,
    cy: 0,
    f0: 0,
    phi: 0,
    size: 4,
    sizeMode: "flat",
    perimeterRef: "center",
    A: 0,
    B: 0,
    f: 90,
  },
};

const DEFAULT_FORM: FormState = {
  bodyType: "RCZ",
  name: "*",
  params: ["0", "0", "0", "1", "1"],
  pattern: { ...DEFAULT_PATTERN, values: { ...DEFAULT_PATTERN.values } },
};

/** Webview-конструктор геометрических тел с превью и EQU. */
export class BodyGeneratorPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private form: FormState = {
    ...DEFAULT_FORM,
    params: [...DEFAULT_FORM.params],
    pattern: { ...DEFAULT_PATTERN, values: { ...DEFAULT_PATTERN.values } },
  };
  private meshApi = loadMeshPreviewApi();
  private types: BodyTypeOption[] = [];
  private lastUri: vscode.Uri | undefined;
  private lastLine = 0;
  private lastChar = 0;
  private editorWatch: vscode.Disposable[] = [];
  private manualSlicePositions: Partial<{ x: number; y: number; z: number }> | undefined;
  private manualSliceTimer: ReturnType<typeof setTimeout> | undefined;
  private previewGeneration = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    try {
      this.types = loadBodyGeneratorApi().listBodyGeneratorTypes();
    } catch {
      this.types = [];
    }
  }

  async show(client?: LanguageClient): Promise<void> {
    this.client = client;
    if (!this.types.length) {
      try {
        this.types = loadBodyGeneratorApi().listBodyGeneratorTypes();
      } catch {
        this.types = [];
      }
    }
    this.rememberEditor();
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.watchEditors();
      this.panel.webview.html = this.getHtml(this.panel.webview);
      await this.pushState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.bodyGenerator",
      "MCU-NR: Генератор тел",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg));
    this.watchEditors();
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      for (const d of this.editorWatch) d.dispose();
      this.editorWatch = [];
      this.manualSlicePositions = undefined;
      if (this.manualSliceTimer) clearTimeout(this.manualSliceTimer);
      this.manualSliceTimer = undefined;
    });
    await this.pushState();
  }

  private async onMessage(msg: {
    type?: string;
    form?: Partial<FormState>;
    pattern?: PatternState;
    positions?: Partial<{ x: number; y: number; z: number }>;
  }): Promise<void> {
    if (!this.panel) return;
    switch (msg.type) {
      case "ready":
        await this.pushState();
        break;
      case "preview":
        if (msg.form) {
          this.applyForm(msg.form);
          this.manualSlicePositions = undefined;
        }
        if (msg.pattern) this.applyPattern(msg.pattern);
        this.postPreview();
        break;
      case "slicePlanesChanged":
        this.manualSlicePositions = {
          x: typeof msg.positions?.x === "number" ? msg.positions.x : undefined,
          y: typeof msg.positions?.y === "number" ? msg.positions.y : undefined,
          z: typeof msg.positions?.z === "number" ? msg.positions.z : undefined,
        };
        if (this.manualSliceTimer) clearTimeout(this.manualSliceTimer);
        this.manualSliceTimer = setTimeout(() => {
          this.manualSliceTimer = undefined;
          this.postPreview();
        }, 150);
        break;
      case "sliceVisibilityChanged": {
        const visibility = parseSliceVisibilityMessage(msg);
        if (visibility) await saveSliceVisibility(this.context, visibility);
        break;
      }
      case "insert":
        if (msg.form) this.applyForm(msg.form);
        if (msg.pattern) this.applyPattern(msg.pattern);
        await this.insertIntoEditor();
        break;
      case "refresh":
        await this.pushState();
        break;
      default:
        break;
    }
  }

  private applyForm(partial: Partial<FormState>): void {
    if (partial.bodyType) this.form.bodyType = partial.bodyType;
    if (partial.name !== undefined) {
      this.form.name = loadBodyGeneratorApi().sanitizeBodyName(partial.name);
    }
    if (partial.params) this.form.params = [...partial.params];
    if (partial.pattern) this.applyPattern(partial.pattern);
  }

  private applyPattern(partial: PatternState): void {
    const group = partial.group === "array" || partial.group === "curve" || partial.group === "mirror" ? partial.group : "none";
    const excluded =
      group === "none"
        ? []
        : Array.isArray(partial.excludedIndices)
          ? [...partial.excludedIndices]
          : [...(this.form.pattern?.excludedIndices ?? [])];
    this.form.pattern = {
      group,
      mode: String(partial.mode || this.form.pattern?.mode || "linear"),
      excludedIndices: excluded,
      values: { ...(this.form.pattern?.values ?? DEFAULT_PATTERN.values), ...(partial.values ?? {}) },
    };
  }

  private rememberEditor(editor?: vscode.TextEditor): void {
    const ed = editor ?? vscode.window.activeTextEditor;
    if (!ed || !isMcunrDocument(ed.document)) return;
    this.lastUri = ed.document.uri;
    this.lastLine = ed.selection.active.line;
    this.lastChar = ed.selection.active.character;
  }

  private watchEditors(): void {
    if (this.editorWatch.length) return;
    this.editorWatch.push(
      vscode.window.onDidChangeActiveTextEditor((e) => this.rememberEditor(e)),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (isMcunrDocument(e.textEditor.document)) this.rememberEditor(e.textEditor);
      })
    );
  }

  private targetUri(): vscode.Uri | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && isMcunrDocument(active.document)) {
      this.rememberEditor(active);
      return active.document.uri;
    }
    if (this.lastUri) return this.lastUri;
    const vis = vscode.window.visibleTextEditors.find((e) => isMcunrDocument(e.document));
    if (vis) {
      this.rememberEditor(vis);
      return vis.document.uri;
    }
    return undefined;
  }

  private cursorPos(): { line: number; character: number } {
    const active = vscode.window.activeTextEditor;
    if (active && isMcunrDocument(active.document)) {
      return {
        line: active.selection.active.line,
        character: active.selection.active.character,
      };
    }
    return { line: this.lastLine, character: this.lastChar };
  }

  private async fetchIndexPayload(): Promise<{
    summaries?: {
      constants?: VisibleConstant[];
      bodies?: Array<{ name: string; scope?: string }>;
    };
    editorContext?: { scope?: string };
  } | null> {
    const uri = this.targetUri();
    if (!uri || !this.client) return null;
    const { line, character } = this.cursorPos();
    try {
      return await this.client.sendRequest("mcuhelper/getIndex", {
        uri: uri.toString(),
        line,
        character,
      });
    } catch {
      return null;
    }
  }

  private async resolveInsertName(): Promise<string> {
    const api = loadBodyGeneratorApi();
    const name = api.sanitizeBodyName(this.form.name);
    if (name !== "*") return name;
    const index = await this.fetchIndexPayload();
    const scope = index?.editorContext?.scope ?? "global";
    const existing = (index?.summaries?.bodies ?? [])
      .filter((b) => (b.scope ?? "global") === scope)
      .map((b) => b.name);
    return api.allocateBodyName(this.form.bodyType, existing);
  }

  private async fetchIndexConstants(opts: {
    uri: vscode.Uri;
    line?: number;
    character?: number;
  }): Promise<VisibleConstant[]> {
    if (!this.client) return [];
    try {
      const args =
        opts.line != null
          ? { uri: opts.uri.toString(), line: opts.line, character: opts.character }
          : { uri: opts.uri.toString() };
      const index = await this.client.sendRequest<{
        summaries?: { constants?: VisibleConstant[] };
      }>("mcuhelper/getIndex", args);
      return index?.summaries?.constants ?? [];
    } catch {
      return [];
    }
  }

  private mergeConstants(primary: VisibleConstant[], extra: VisibleConstant[]): VisibleConstant[] {
    const map = new Map<string, VisibleConstant>();
    for (const c of extra) map.set(c.name.toUpperCase(), c);
    for (const c of primary) map.set(c.name.toUpperCase(), c);
    return [...map.values()];
  }

  private async fetchConstants(): Promise<VisibleConstant[]> {
    const uri = this.targetUri();
    if (!uri || !this.client) return [];
    const active = vscode.window.activeTextEditor;
    const line =
      active && isMcunrDocument(active.document) ? active.selection.active.line : this.lastLine;
    const character =
      active && isMcunrDocument(active.document)
        ? active.selection.active.character
        : this.lastChar;
    const scoped = await this.fetchIndexConstants({ uri, line, character });
    if (scoped.length > 0) return scoped;
    return this.fetchIndexConstants({ uri });
  }

  private async fetchScene(): Promise<GeometrySceneLike | null> {
    const uri = this.targetUri();
    if (!uri || !this.client) return null;
    const { line, character } = this.cursorPos();
    try {
      return await this.client.sendRequest<GeometrySceneLike | null>("mcuhelper/getGeometry", {
        uri: uri.toString(),
        line,
        character,
      });
    } catch {
      return null;
    }
  }

  private async pushState(): Promise<void> {
    if (!this.panel) return;
    if (!this.types.length) {
      try {
        this.types = loadBodyGeneratorApi().listBodyGeneratorTypes();
      } catch (e) {
        void this.panel.webview.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const constants = await this.fetchConstants();
    void this.panel.webview.postMessage({
      type: "state",
      form: this.form,
      types: this.types,
      constants,
      docLabel: this.lastUri
        ? `${vscode.workspace.asRelativePath(this.lastUri)}:${this.lastLine + 1} · ${constants.length} EQU`
        : `(нет активного mcunr) · ${constants.length} EQU`,
    });
    this.postPreview();
  }

  private postPreview(): void {
    void this.runPreview();
  }

  private fmtParamNum(n: number): string {
    if (!Number.isFinite(n)) return "0";
    return Number(n.toFixed(9)).toString();
  }

  /** Развёртка позы → строковые параметры с сохранением EQU исходника. */
  private poseToParamStrings(
    bodyType: string,
    seedParams: string[],
    resolvedNums: number[],
    pose: {
      kind: string;
      dx?: number | string;
      dy?: number | string;
      dz?: number | string;
      A?: number | string;
      B?: number | string;
      f?: number | string;
    }
  ): string[] | null {
    const arr = loadBodyArrayGeneratorApi();
    const kind = this.poseKind(pose);
    if (kind === "T") {
      return arr.applyTranslateToBodyParamStrings(
        bodyType,
        seedParams,
        Number(pose.dx ?? 0),
        Number(pose.dy ?? 0),
        Number(pose.dz ?? 0)
      );
    }
    const next = this.applyPoseToParams(bodyType, resolvedNums, pose);
    if (!next) return null;
    return arr.mergePreservedParamStrings(seedParams, resolvedNums, next);
  }

  private applyPoseToParams(
    bodyType: string,
    params: number[],
    pose: {
    kind: string;
    dx?: number | string;
    dy?: number | string;
    dz?: number | string;
    A?: number | string;
    B?: number | string;
    f?: number | string;
  }
  ): number[] | null {
    if (!this.meshApi) return null;
    const kind = this.poseKind(pose);
    if (kind === "T") {
      return this.meshApi.translateBodyParams(
        bodyType,
        params,
        Number(pose.dx ?? 0),
        Number(pose.dy ?? 0),
        Number(pose.dz ?? 0)
      );
    }
    if (kind === "R" || kind === "M") {
      return this.meshApi.applyTransfToBodyParams(
        bodyType,
        params,
        kind,
        Number(pose.A ?? 0),
        Number(pose.B ?? 0),
        Number(pose.f ?? 0)
      );
    }
    return null;
  }

  private resolvePatternValues(
    values: Record<string, number | string>,
    vars: Map<string, number>
  ): { values: Record<string, number | string>; warnings: string[]; ok: boolean } {
    const api = loadBodyGeneratorApi();
    const out: Record<string, number | string> = { ...values };
    const warnings: string[] = [];
    let ok = true;
    for (const [key, raw] of Object.entries(values)) {
      if (key === "stepMode" || key === "sizeMode" || key === "perimeterRef") continue;
      const text = String(raw ?? "").trim();
      if (!text) continue;
      const r = api.resolveBodyParamNumbers([text], vars);
      for (const w of r.warnings) {
        warnings.push(`Массив «${key}»: ${w.replace(/^Параметр #\d+\s*/, "").replace(/^Параметр #\d+ /, "")}`);
      }
      const n = r.nums[0];
      if (!Number.isFinite(n)) ok = false;
      else out[key] = n;
    }
    return { values: out, warnings, ok };
  }

  private currentPattern(): PatternState {
    return this.form.pattern ?? { ...DEFAULT_PATTERN, values: { ...DEFAULT_PATTERN.values } };
  }

  private async existingBodyNames(): Promise<string[]> {
    const index = await this.fetchIndexPayload();
    const scope = index?.editorContext?.scope ?? "global";
    return (index?.summaries?.bodies ?? [])
      .filter((b) => (b.scope ?? "global") === scope)
      .map((b) => b.name);
  }

  private poseKind(pose: { kind: string }): "T" | "R" | "M" | null {
    const k = String(pose.kind || "").toUpperCase();
    if (k === "T" || k === "R" || k === "M") return k;
    return null;
  }

  private async runPreview(): Promise<void> {
    if (!this.panel) return;
    const gen = ++this.previewGeneration;
    try {
      const api = loadBodyGeneratorApi();
      const insertName = await this.resolveInsertName();
      if (gen !== this.previewGeneration || !this.panel) return;
      const built = api.buildBodyStatement({ ...this.toInput(), name: insertName });
      const scene = await this.fetchScene();
      if (gen !== this.previewGeneration || !this.panel) return;
      let constsForEval = await this.fetchConstants();
      if (gen !== this.previewGeneration || !this.panel) return;
      let vars = api.constantsToVarMap(constsForEval);
      const isTransf = this.form.bodyType.toUpperCase() === "TRANSF";
      let resolved = isTransf
        ? { nums: [] as number[], warnings: [] as string[] }
        : api.resolveBodyParamNumbers(this.form.params, vars);
      let transf = isTransf ? api.resolveTransfParams(this.form.params, vars) : null;
      const needRetry = isTransf
        ? (transf?.warnings.some((w) => /не удалось вычислить/i.test(w)) ?? false)
        : resolved.warnings.some((w) => /не удалось вычислить/i.test(w));
      if (needRetry) {
        const uri = this.targetUri();
        if (uri) {
          const all = await this.fetchIndexConstants({ uri });
          if (gen !== this.previewGeneration || !this.panel) return;
          constsForEval = this.mergeConstants(constsForEval, all);
          vars = api.constantsToVarMap(constsForEval);
          if (isTransf) transf = api.resolveTransfParams(this.form.params, vars);
          else resolved = api.resolveBodyParamNumbers(this.form.params, vars);
        }
      }
      const warnings = [...built.warnings, ...(isTransf ? transf?.warnings ?? [] : resolved.warnings)];
      if (!constsForEval.length && this.form.params.some((p) => /[A-Za-z]/.test(p))) {
        if (!isTransf || this.form.params.slice(2).some((p) => /[A-Za-z]/.test(p))) {
          warnings.push(
            "EQU не загружены: кликните в MCU-файл (строка вставки) и нажмите «Обновить константы»."
          );
        }
      }

      const pattern = this.currentPattern();
      const patternActive = pattern.group !== "none";
      const numsOk = !isTransf && resolved.nums.length > 0 && resolved.nums.every(Number.isFinite);
      let previewSeedParams = resolved.nums;
      const extraBodies: Array<{ name: string; bodyType: string; params: number[]; excluded?: boolean }> = [];
      let previewText = built.text;
      let insertOk = built.okToInsert;
      let patternStatus: {
        summary: string;
        hint: string;
        radiusText: string;
        okToInsert: boolean;
        excludedCount?: number;
        instanceCount?: number;
        excludedIndices?: number[];
      } = {
        summary: `Будет вставлено: 1×${this.form.bodyType.toUpperCase()}`,
        hint: "",
        radiusText: "",
        okToInsert: insertOk,
      };

      let arrayInstances: Array<{ index: number; name: string; excluded: boolean }> = [];
      let patternExcludedIndices: number[] = [];

      if (patternActive) {
        const arr = loadBodyArrayGeneratorApi();
        const patVals = this.resolvePatternValues(pattern.values, vars);
        warnings.push(...patVals.warnings);
        if (!patVals.ok) insertOk = false;
        const anchor = numsOk && this.meshApi ? this.meshApi.bodyAnchorPoint(this.form.bodyType, resolved.nums) : null;
        const builtPat = arr.buildPatternInstances({
          group: pattern.group,
          mode: pattern.mode,
          values: patVals.values,
          seedAnchor: anchor ?? undefined,
        });
        warnings.push(...builtPat.warnings);
        const can = arr.patternCanUseTransf(this.form.bodyType, builtPat.useTransfCandidate);
        const expand = !can.ok;
        const excludedSet = new Set(arr.pruneExcludedIndices(pattern.excludedIndices, builtPat.instances.length));
        const excluded = [...excludedSet].sort((a, b) => a - b);
        patternExcludedIndices = excluded;
        this.form.pattern = { ...this.currentPattern(), excludedIndices: excluded };
        const excludedResult = arr.applyPatternExclusions(builtPat.instances, excluded);
        warnings.push(...excludedResult.warnings);
        if (!excludedResult.ok) insertOk = false;
        const activeInstances = excludedResult.instances;
        if (pattern.mode === "hexRings") {
          const rings = Number(patVals.values.rings);
          if (Number.isFinite(rings) && rings >= 0) {
            const n = arr.hexLatticeInstanceCount(rings);
            patternStatus.hint = `Гексагональная упаковка: ${n} позиций (R=${Math.round(rings)}).`;
          } else {
            patternStatus.hint = "Гексагональная упаковка со сдвигом рядов 60° (как на ТВС).";
          }
        }
        if (pattern.mode === "ring") {
          patternStatus.hint = "f0 поворачивает всё кольцо, включая исходник (как TRANSF R).";
          const cx = Number(patVals.values.cx);
          const cy = Number(patVals.values.cy);
          if (anchor && Number.isFinite(cx) && Number.isFinite(cy)) {
            const r = Math.hypot(anchor.x - cx, anchor.y - cy);
            patternStatus.radiusText = `R ≈ ${Number(r.toFixed(4))}`;
          }
        }
        if (pattern.mode === "segment") {
          patternStatus.hint = "Начало отрезка — центр исходника; P1 — конец в координатах сцены.";
        }
        if (pattern.mode === "trianglePerimeter" || pattern.mode === "hexPerimeter") {
          const ref = String(patVals.values.perimeterRef || "center");
          patternStatus.hint =
            ref === "seed"
              ? "Исходник на контуре: образующая проходит через центр прототипа."
              : "Центр (cx, cy): исходник переносится на контур, копии по периметру.";
        }
        if (!numsOk) {
          warnings.push("Массив: не удалось вычислить числовые параметры исходника (EQU).");
          insertOk = false;
        }
        const existing = await this.existingBodyNames();
        if (gen !== this.previewGeneration || !this.panel) return;
        const emitInput = {
          seed: { bodyType: this.form.bodyType, name: insertName, params: this.form.params },
          expand,
          canUseTransf: can.ok,
          existingNames: existing,
          transformExpanded: (pose: { kind: string; [k: string]: number | string }) =>
            this.poseToParamStrings(this.form.bodyType, this.form.params, resolved.nums, pose),
        };
        const pickEmit =
          numsOk && patVals.ok && builtPat.ok
            ? arr.emitBodyArray({ ...emitInput, instances: builtPat.instances })
            : null;
        arrayInstances =
          pickEmit?.names.map((name, index) => ({ index, name, excluded: excludedSet.has(index) })) ?? [];
        const emit =
          numsOk && patVals.ok && excludedResult.ok
            ? arr.emitBodyArray({ ...emitInput, instances: activeInstances })
            : { text: "", warnings: [], okToInsert: false, summary: "", names: [insertName] };
        warnings.push(...emit.warnings);
        insertOk = insertOk && builtPat.ok && excludedResult.ok && emit.okToInsert && numsOk && patVals.ok;
        previewText = emit.text || built.text;
        const excludedHint =
          excludedResult.excludedCount > 0
            ? `исключено ${excludedResult.excludedCount} · вставка ${activeInstances.length}`
            : "";
        patternStatus = {
          ...patternStatus,
          summary: `Будет вставлено: ${emit.summary || builtPat.summary} · N=${activeInstances.length}${excludedHint ? ` · ${excludedHint}` : ""}`,
          okToInsert: insertOk,
          excludedCount: excludedResult.excludedCount,
          instanceCount: builtPat.instances.length,
          excludedIndices: excluded,
        };
        if (numsOk && this.meshApi) {
          const pose0 = builtPat.instances[0]?.pose;
          if (pose0) {
            const moved = this.applyPoseToParams(this.form.bodyType, resolved.nums, pose0);
            if (moved) previewSeedParams = moved;
          }
          for (let i = 1; i < builtPat.instances.length; i++) {
            const inst = builtPat.instances[i];
            if (!inst) continue;
            const next = this.applyPoseToParams(this.form.bodyType, resolved.nums, inst.pose);
            if (!next) {
              warnings.push(`Превью копии ${i}: не удалось преобразовать параметры.`);
              continue;
            }
            extraBodies.push({
              name: pickEmit?.names[i] ?? `C${i}`,
              bodyType: this.form.bodyType,
              params: next,
              excluded: excludedSet.has(i),
            });
          }
        }
      }

      let draftPreview: ReturnType<MeshPreviewApi["buildDraftBodyPreview"]> | null = null;
      if (this.meshApi && isTransf && transf?.ok) {
        draftPreview = this.meshApi.buildDraftBodyPreview({
          bodyType: "TRANSF",
          name: insertName,
          params: [transf.A, transf.B, transf.f],
          scenePrimitives: scene?.primitives ?? [],
          sceneBbox: scene?.bbox,
          nearby: {},
          extraBodies,
          slicePositions: this.manualSlicePositions,
          transf: {
            protoName: transf.protoName,
            mode: transf.mode,
            A: transf.A,
            B: transf.B,
            f: transf.f,
          },
        });
        warnings.push(...(draftPreview.warnings ?? []));
      } else if (this.meshApi && numsOk) {
        draftPreview = this.meshApi.buildDraftBodyPreview({
          bodyType: this.form.bodyType,
          name: insertName,
          params: previewSeedParams,
          scenePrimitives: scene?.primitives ?? [],
          sceneBbox: scene?.bbox,
          nearby: {},
          extraBodies,
          slicePositions: this.manualSlicePositions,
        });
        warnings.push(...(draftPreview.warnings ?? []));
      }

      if (gen !== this.previewGeneration || !this.panel) return;
      void this.panel.webview.postMessage({
        type: "preview",
        text: previewText,
        warnings,
        constants: constsForEval,
        draftPreview,
        autoName: this.form.name === "*" ? insertName : null,
        patternStatus,
        arrayInstances,
        patternExcludedIndices: patternActive ? patternExcludedIndices : undefined,
      });
    } catch (e) {
      if (gen !== this.previewGeneration || !this.panel) return;
      void this.panel.webview.postMessage({
        type: "preview",
        text: "",
        warnings: [e instanceof Error ? e.message : String(e)],
        draftPreview: null,
      });
    }
  }

  private toInput(): BodyGeneratorInput {
    return {
      bodyType: this.form.bodyType,
      name: this.form.name,
      params: this.form.params,
    };
  }

  private async insertIntoEditor(): Promise<void> {
    const uri = this.targetUri();
    if (!uri) {
      vscode.window.showWarningMessage("Откройте файл MCU-NR и снова нажмите «Вставить».");
      return;
    }
    const { buildBodyStatement, isValidBodyName, sanitizeBodyName } = loadBodyGeneratorApi();
    this.form.name = sanitizeBodyName(this.form.name);
    if (!isValidBodyName(this.form.name)) {
      vscode.window.showWarningMessage(
        "Имя тела: буква и до 5 букв/цифр (всего ≤6). Нельзя U и T. Можно «*»."
      );
      return;
    }
    const insertName = await this.resolveInsertName();
    const pattern = this.currentPattern();
    let built = buildBodyStatement({ ...this.toInput(), name: insertName });
    if (pattern.group !== "none") {
      const api = loadBodyGeneratorApi();
      const arr = loadBodyArrayGeneratorApi();
      const vars = api.constantsToVarMap(await this.fetchConstants());
      const resolved = api.resolveBodyParamNumbers(this.form.params, vars);
      if (!resolved.nums.length || resolved.nums.some((n) => !Number.isFinite(n))) {
        vscode.window.showWarningMessage("Не удалось вычислить параметры исходника (EQU) для массива.");
        return;
      }
      const patVals = this.resolvePatternValues(pattern.values, vars);
      if (!patVals.ok) {
        vscode.window.showWarningMessage(patVals.warnings[0] ?? "Не удалось вычислить параметры массива (EQU).");
        return;
      }
      const anchor = this.meshApi?.bodyAnchorPoint(this.form.bodyType, resolved.nums) ?? undefined;
      const builtPat = arr.buildPatternInstances({
        group: pattern.group,
        mode: pattern.mode,
        values: patVals.values,
        seedAnchor: anchor,
      });
      if (!builtPat.ok) {
        vscode.window.showWarningMessage(builtPat.warnings[0] ?? "Исправьте параметры массива перед вставкой.");
        return;
      }
      const excluded = arr.pruneExcludedIndices(pattern.excludedIndices, builtPat.instances.length);
      const excludedResult = arr.applyPatternExclusions(builtPat.instances, excluded);
      if (!excludedResult.ok) {
        vscode.window.showWarningMessage(excludedResult.warnings[0] ?? "Исключения массива некорректны.");
        return;
      }
      const can = arr.patternCanUseTransf(this.form.bodyType, builtPat.useTransfCandidate);
      const emit = arr.emitBodyArray({
        seed: { bodyType: this.form.bodyType, name: insertName, params: this.form.params },
        instances: excludedResult.instances,
        expand: !can.ok,
        canUseTransf: can.ok,
        existingNames: await this.existingBodyNames(),
        transformExpanded: (pose) =>
          this.poseToParamStrings(this.form.bodyType, this.form.params, resolved.nums, pose),
      });
      built = { text: emit.text, warnings: [...builtPat.warnings, ...emit.warnings], okToInsert: emit.okToInsert };
    }
    if (!built.okToInsert) {
      vscode.window.showWarningMessage(built.warnings[0] ?? "Исправьте параметры перед вставкой.");
      return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, Math.min(this.lastLine, Math.max(0, doc.lineCount - 1)));
    const lineText = doc.lineAt(line).text;
    const insertText =
      lineText.trim().length === 0 ? built.text : `\n${built.text.replace(/\n$/, "")}\n`;
    const edit = new vscode.WorkspaceEdit();
    if (lineText.trim().length === 0) {
      edit.insert(doc.uri, new vscode.Position(line, 0), built.text);
    } else {
      edit.insert(doc.uri, new vscode.Position(line, lineText.length), insertText);
    }
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage("Не удалось вставить тело");
      return;
    }
    const nLines = built.text.trim().split(/\n+/).filter(Boolean).length;
    vscode.window.showInformationMessage(
      nLines > 1
        ? `Вставлено ${nLines} тел (можно Undo).`
        : insertName !== this.form.name && this.form.name === "*"
          ? `Тело вставлено как «${insertName}» (можно Undo).`
          : "Тело вставлено (можно Undo)."
    );
    await this.pushState();
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private renderTypeOptions(selected: string): string {
    return this.types
      .map((t) => {
        const sel = t.key === selected ? " selected" : "";
        return `<option value="${this.escapeHtml(t.key)}"${sel}>${this.escapeHtml(t.key)} — ${this.escapeHtml(t.title)}</option>`;
      })
      .join("\n            ");
  }

  private renderParamRows(typeKey: string, values: string[]): string {
    const t = this.types.find((x) => x.key === typeKey) ?? this.types[0];
    if (!t) return "";
    return t.fields
      .map((f, i) => {
        const val = values[i] ?? f.defaultValue;
        const labClass = f.hint ? ' class="has-hint"' : "";
        return `<div class="bg-param-row">
            <label for="param_${i}"${labClass}>${this.escapeHtml(f.label)}</label>
            <input id="param_${i}" list="equList" value="${this.escapeHtml(val)}" placeholder="${this.escapeHtml(f.defaultValue)}" />
          </div>`;
      })
      .join("\n          ");
  }

  private getHtml(webview: vscode.Webview): string {
    const bust = String(Date.now());
    const css = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "bodyGenerator", "bodyGenerator.css"))
      .with({ query: `v=${bust}` });
    const js = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "bodyGenerator", "bodyGenerator.js"))
      .with({ query: `v=${bust}` });
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join("; ");

    const selected = this.form.bodyType || "RCZ";
    const current = this.types.find((t) => t.key === selected) ?? this.types[0];
    const sliceVisibility = loadSliceVisibility(this.context);
    const boot = JSON.stringify({
      types: this.types,
      form: this.form,
      constants: [],
      sliceVisibility,
    }).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>Генератор тел</title>
</head>
<body>
  <div id="root">
    <header class="bg-header">
      <div>
        <h1>Генератор тел</h1>
        <p class="bg-sub">Тип · параметры · EQU · превью с ближайшими соседями</p>
      </div>
      <div class="bg-doc" id="docLabel"></div>
    </header>

    <div class="bg-layout">
      <form class="bg-form" id="form" autocomplete="off">
        <fieldset>
          <legend>Тело</legend>
          <label class="bg-field">
            <span>Тип <em id="typeCount" class="bg-count">(${this.types.length})</em></span>
            <select name="bodyType" id="bodyType">
            ${this.renderTypeOptions(selected)}
            </select>
          </label>
          <p class="bg-type-desc" id="typeDesc">${this.escapeHtml(current?.description ?? "")}</p>
          <label class="bg-field">
            <span>Имя</span>
            <input name="name" id="name" value="${this.escapeHtml(this.form.name)}" placeholder="*" maxlength="6" spellcheck="false" autocomplete="off" pattern="[A-Za-z][A-Za-z0-9]{0,5}|\\*" />
            <span class="bg-hint" id="nameHint">Буква + до 5 букв/цифр (≤6), латиница. Нельзя U и T (служебные). Пробелы, кириллица и цифра в начале нельзя. «*» — автоимя (подставится свободное, напр. H1).</span>
            <span class="bg-hint" id="autoNameHint"></span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Параметры</legend>
          <div id="params" class="bg-params">
          ${this.renderParamRows(selected, this.form.params)}
          </div>
          <datalist id="equList"></datalist>
          <p class="bg-hint">Число, имя EQU/SET (список подсказок) или выражение, например <code>12.5+LG2</code>.</p>
        </fieldset>

        <fieldset class="bg-pattern">
          <legend>Массив / копии</legend>
          <div class="bg-pattern-groups" role="radiogroup" aria-label="Группа массива">
            <label><input type="radio" name="patternGroup" value="none" checked /> Нет</label>
            <label><input type="radio" name="patternGroup" value="array" /> Массив</label>
            <label><input type="radio" name="patternGroup" value="curve" /> По кривой</label>
            <label><input type="radio" name="patternGroup" value="mirror" /> Зеркало</label>
          </div>
          <div id="patternFields" hidden>
            <label class="bg-field">
              <span>Режим</span>
              <select id="patternMode"></select>
            </label>
            <div class="bg-presets" id="patternPresets"></div>
            <div id="patternModeFields" class="bg-params bg-pattern-mode-fields"></div>
            <p class="bg-hint" id="patternModeHint"></p>
            <p class="bg-pattern-status" id="patternStatus">Будет вставлено: 1×RCZ</p>
            <p class="bg-hint" id="patternExcludeHint" hidden>На сечении: инструмент «Исключить» — клик по копии убирает её из вставки (исходник остаётся).</p>
            <button type="button" class="bg-preset" id="btnResetExclusions" hidden title="Показать все элементы массива">Сбросить исключения</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Окружение</legend>
          <p class="bg-hint">Все соседние тела на сечении; яркость линии падает с расстоянием до черновика.</p>
          <p class="bg-nearest" id="nearestInfo">ближайшее: —</p>
        </fieldset>

        <div class="bg-actions">
          <button type="button" class="bg-btn secondary" id="btnRefresh">Обновить константы</button>
          <button type="button" class="bg-btn primary" id="btnInsert">Вставить в документ</button>
        </div>
      </form>

      <aside class="bg-preview">
        <div class="bg-preview-head">
          <h2>Сечения</h2>
          <span class="bg-muted" id="neighborInfo"></span>
        </div>
        <p class="bg-hint bg-slice-hint">палитра → клик на сечении · или клик по телу / кнопка Правка → ручки · при правке вид не авто-зумится · колесо — зум</p>
        <div class="bg-prim-palette" id="primPalette" role="toolbar" aria-label="Примитивы"></div>
        <div class="bg-slice-tools" id="sliceToolBar" role="toolbar" aria-label="Инструменты сечения">
          <button type="button" class="bg-tool-btn is-active" id="btnToolPan" title="Перемещение вида">Перемещение</button>
          <button type="button" class="bg-tool-btn" id="btnToolEdit" title="Правка тела: перенос, размер, поворот за характерные точки">Правка</button>
          <button type="button" class="bg-tool-btn" id="btnToolExclude" hidden title="Клик по копии массива — исключить/вернуть в вставку">Исключить</button>
          <button type="button" class="bg-tool-btn" id="btnToolRuler" title="Линейка: две точки, прилипание к фигурам и осям">Линейка</button>
          <span class="bg-cursor-coords" id="cursorCoords" title="Координаты под курсором">—</span>
        </div>
        <div class="bg-slice-vis" id="sliceVisBar" role="toolbar" aria-label="Видимость сечений">
          <button type="button" class="bg-slice-vis-btn" data-slot="xy" title="Показать/скрыть XY">XY</button>
          <button type="button" class="bg-slice-vis-btn" data-slot="xz" title="Показать/скрыть XZ">XZ</button>
          <button type="button" class="bg-slice-vis-btn" data-slot="yz" title="Показать/скрыть YZ">YZ</button>
        </div>
        <div class="bg-slices" id="slicesRoot">
          <section class="bg-slice-panel" data-slot="xy" data-axis="z">
            <div class="bg-slice-control-host" id="sliceControlZ"></div>
            <figure class="bg-slice">
              <figcaption id="capXY">XY</figcaption>
              <div class="bg-slice-view"><canvas id="sliceXY"></canvas></div>
            </figure>
          </section>
          <section class="bg-slice-panel" data-slot="xz" data-axis="y">
            <div class="bg-slice-control-host" id="sliceControlY"></div>
            <figure class="bg-slice">
              <figcaption id="capXZ">XZ</figcaption>
              <div class="bg-slice-view"><canvas id="sliceXZ"></canvas></div>
            </figure>
          </section>
          <section class="bg-slice-panel" data-slot="yz" data-axis="x">
            <div class="bg-slice-control-host" id="sliceControlX"></div>
            <figure class="bg-slice">
              <figcaption id="capYZ">YZ</figcaption>
              <div class="bg-slice-view"><canvas id="sliceYZ"></canvas></div>
            </figure>
          </section>
        </div>
        <ul class="bg-warnings" id="warnings"></ul>
        <pre id="preview" class="bg-code"></pre>
      </aside>
    </div>
  </div>
  <script type="application/json" id="bg-boot">${boot}</script>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
