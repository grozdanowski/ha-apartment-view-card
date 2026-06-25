export interface PreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function pointToPercent(
  clientX: number,
  clientY: number,
  rect: PreviewRect
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
}

export function percentToPoint(
  xPct: number,
  yPct: number,
  rect: PreviewRect
): { x: number; y: number } {
  return {
    x: (xPct / 100) * rect.width,
    y: (yPct / 100) * rect.height,
  };
}

export function rectFromDrag(
  startXPct: number,
  startYPct: number,
  endXPct: number,
  endYPct: number
): { x: number; y: number; width: number; height: number } {
  const x0 = clamp(Math.min(startXPct, endXPct), 0, 100);
  const y0 = clamp(Math.min(startYPct, endYPct), 0, 100);
  const x1 = clamp(Math.max(startXPct, endXPct), 0, 100);
  const y1 = clamp(Math.max(startYPct, endYPct), 0, 100);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
