const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
];

const BODY_PALETTE = [
  "#6699cc", "#99cc66", "#cc9966", "#9966cc", "#66cccc",
  "#cc6699", "#cccc66", "#669966", "#6666cc", "#cc6666",
];

export function colorForMaterial(n?: number): string {
  if (!n) return "#888888";
  return PALETTE[(n - 1) % PALETTE.length];
}

export function colorForZone(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function colorForBody(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BODY_PALETTE[h % BODY_PALETTE.length];
}

export { PALETTE };
