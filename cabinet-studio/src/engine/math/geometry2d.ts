import { add, cross, dot, EPS, length, scale, sub, type Vec2 } from './vec';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export interface Projection {
  /** Parameter along the segment, 0 at a, 1 at b (unclamped). */
  t: number;
  /** Closest point on the clamped segment. */
  point: Vec2;
  /** Distance from the query point to `point`. */
  distance: number;
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 < EPS ? 0 : dot(sub(p, a), ab) / len2;
  const tc = Math.min(1, Math.max(0, t));
  const point = add(a, scale(ab, tc));
  return { t, point, distance: length(sub(p, point)) };
}

/** Intersection of two infinite lines given as point + direction. Null if parallel. */
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / denom;
  return add(p1, scale(d1, t));
}

/** Signed area; positive for counter-clockwise polygons. */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Clip a convex polygon by the half-plane dot(p, n) >= c (Sutherland–Hodgman, one plane).
 * Used to cut wall prisms around openings.
 */
export function clipConvexByHalfPlane(poly: Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dot(p, n) - c;
    const dq = dot(q, n) - c;
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push(add(p, scale(sub(q, p), t)));
    }
  }
  return out;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Vec2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Overlap length of two 1D intervals (0 if they only touch or are apart). */
export function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}
