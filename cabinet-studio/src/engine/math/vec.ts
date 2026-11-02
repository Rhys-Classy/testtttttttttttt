// Plain-data vector maths. The engine never uses three.js types so that it can run
// in Node (tests, CLI exports, workers) and stays independent of the renderer.
// All lengths are millimetres.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const EPS = 1e-6;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z component of the 3D cross product (a.x, a.y, 0) × (b.x, b.y, 0). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate +90° (counter-clockwise). */
export const perpLeft = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
/** Rotate -90° (clockwise). */
export const perpRight = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });

export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const fromAngle = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

export function approxEq(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

export function vecApproxEq(a: Vec2, b: Vec2, tol = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Normalise an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Round to a step; `step <= 0` returns the value unchanged. */
export function snapTo(v: number, step: number, origin = 0): number {
  if (step <= 0) return v;
  return origin + Math.round((v - origin) / step) * step;
}

/** Round away floating-point noise (0.1 µm) so values like 283.99999999 read as 284. */
export function clean(v: number): number {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;
