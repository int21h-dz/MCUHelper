/** Состояние scope геометрии: global | cell:NAME | lcell:NAME (UserGuide §9.2.2, §9.2.5). */
export type CellPhase = "bodies" | "zones" | "lattice" | null;

export interface GeometryScopeState {
  scope: string;
  cellPhase: CellPhase;
  cellExtend: boolean;
}

export function initialGeometryScopeState(): GeometryScopeState {
  return { scope: "global", cellPhase: null, cellExtend: false };
}

/**
 * Переход scope по метке строки. CELL: первый END — конец тел (scope сохраняется),
 * второй END — конец зон (выход, кроме EXTEND); EXTEND закрывается ENDXCL (§9.4).
 */
export function applyGeometryScopeTransition(
  state: GeometryScopeState,
  label: string,
  text: string
): void {
  const upper = label.toUpperCase();

  if (upper === "LCELL") {
    const m = text.match(/^LCELL\s+(\w+)/i);
    if (m) {
      state.scope = `lcell:${m[1]}`;
      state.cellPhase = null;
      state.cellExtend = false;
    }
    return;
  }

  if (upper === "ENDL") {
    state.scope = "global";
    state.cellPhase = null;
    state.cellExtend = false;
    return;
  }

  if (upper === "CELL") {
    const m = text.match(/^CELL\s+(\w+)/i);
    if (m) {
      state.scope = `cell:${m[1]}`;
      state.cellPhase = "bodies";
      state.cellExtend = /\bEXTEND\b/i.test(text);
    }
    return;
  }

  if (upper === "ENDXCL") {
    state.scope = "global";
    state.cellPhase = null;
    state.cellExtend = false;
    return;
  }

  if (upper === "END" && state.scope.startsWith("cell:")) {
    if (state.cellPhase === "bodies") {
      state.cellPhase = "zones";
    } else if (state.cellPhase === "zones") {
      if (state.cellExtend) {
        state.cellPhase = "lattice";
      } else {
        state.scope = "global";
        state.cellPhase = null;
        state.cellExtend = false;
      }
    }
  }
}
