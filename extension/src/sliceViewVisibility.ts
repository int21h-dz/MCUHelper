import type * as vscode from "vscode";

export type SliceSlotId = "xy" | "xz" | "yz";

export type SliceVisibility = Record<SliceSlotId, boolean>;

export const DEFAULT_SLICE_VISIBILITY: SliceVisibility = {
  xy: true,
  xz: true,
  yz: true,
};

const GLOBAL_STATE_KEY = "mcuhelper.sliceViewVisibility";

function normalize(raw: Partial<SliceVisibility> | undefined): SliceVisibility {
  return {
    xy: raw?.xy !== false,
    xz: raw?.xz !== false,
    yz: raw?.yz !== false,
  };
}

/** Видимость ортогональных сечений (XY/XZ/YZ) — общая для генератора и live preview. */
export function loadSliceVisibility(context: vscode.ExtensionContext): SliceVisibility {
  return normalize(context.globalState.get<Partial<SliceVisibility>>(GLOBAL_STATE_KEY));
}

export async function saveSliceVisibility(
  context: vscode.ExtensionContext,
  visibility: SliceVisibility
): Promise<void> {
  const next = normalize(visibility);
  // Не даём спрятать все три — иначе превью пустеет без смысла.
  if (!next.xy && !next.xz && !next.yz) {
    next.xy = true;
  }
  await context.globalState.update(GLOBAL_STATE_KEY, next);
}

export function parseSliceVisibilityMessage(msg: unknown): SliceVisibility | null {
  const raw = (msg as { visibility?: Partial<SliceVisibility> } | null)?.visibility;
  if (!raw || typeof raw !== "object") return null;
  return normalize(raw);
}
