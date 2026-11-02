// Pure maths for the touch 2D view (no React, no DOM). World is mm, y up.

export interface P2 {
  x: number;
  y: number;
}
export interface View2D {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /** Pixels per mm. */
  scale: number;
}
export interface Size2D {
  w: number;
  h: number;
}
export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 5;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function worldToScreen(v: View2D, size: Size2D, p: P2): P2 {
  return { x: size.w / 2 + (p.x - v.cx) * v.scale, y: size.h / 2 - (p.y - v.cy) * v.scale };
}

export function screenToWorld(v: View2D, size: Size2D, p: P2): P2 {
  return { x: v.cx + (p.x - size.w / 2) / v.scale, y: v.cy - (p.y - size.h / 2) / v.scale };
}

/** View that shows `b` centred inside `size` with `pad` px around it. */
export function fitView(b: Bounds2D, size: Size2D, pad = 40): View2D {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const scale = clampScale(Math.min(Math.max(1, size.w - 2 * pad) / w, Math.max(1, size.h - 2 * pad) / h));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale };
}

export function boundsOfPoints(pts: P2[]): Bounds2D | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInRect(p: P2, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
}

/** Zoom by `factor` keeping the world point under screen point `at` fixed. */
export function zoomAt(v: View2D, size: Size2D, at: P2, factor: number): View2D {
  const w = screenToWorld(v, size, at);
  const scale = clampScale(v.scale * factor);
  return { scale, cx: w.x - (at.x - size.w / 2) / scale, cy: w.y + (at.y - size.h / 2) / scale };
}

/** Pan so a screen-space drag of (dx, dy) px moves the content with the fingers. */
export function panBy(v: View2D, dx: number, dy: number): View2D {
  return { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale };
}

/**
 * Pinch: the world point that was under the previous centroid ends up under the new
 * centroid, with the scale changed by the ratio of finger distances.
 */
export function pinch(v: View2D, size: Size2D, prev: [P2, P2], next: [P2, P2]): View2D {
  const mid = (a: P2, b: P2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
  const d1 = Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y);
  const m0 = mid(prev[0], prev[1]);
  const m1 = mid(next[0], next[1]);
  const anchor = screenToWorld(v, size, m0);
  const scale = clampScale(d0 > 1 ? v.scale * (d1 / d0) : v.scale);
  return { scale, cx: anchor.x - (m1.x - size.w / 2) / scale, cy: anchor.y + (m1.y - size.h / 2) / scale };
}

/** Grid lines to draw: world values within the visible range for a spacing, or [] if too dense. */
export function gridLines(min: number, max: number, step: number, scale: number, minPx = 6): number[] {
  if (step * scale < minPx) return [];
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
