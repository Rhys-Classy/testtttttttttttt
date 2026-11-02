// Placement assistance for drag-and-drop: wall attachment, butting against neighbours,
// face alignment, collision avoidance and grid snapping. Pure functions on plan data.

import { overlap1D, projectOnSegment } from '../math/geometry2d';
import { frameOf, type Placement } from '../math/placement';
import { add, angleDiff, distance, dot, fromAngle, normalize, perpLeft, scale, snapTo, sub, type Vec2 } from '../math/vec';
import type { Wall } from '../model/types';
import type { WallFace } from '../room/walls';
import { worldFootprint, type Extents } from './extents';

export interface SnapSettings {
  walls: boolean;
  items: boolean;
  grid: boolean;
  gridSize: number;
  /** Max distance (mm) an edge jumps to a neighbour / face end. */
  snapDistance: number;
  /** How far from a wall face the footprint centre may be and still attach. */
  wallRange: number;
}

export const DEFAULT_SNAP: SnapSettings = { walls: true, items: true, grid: true, gridSize: 10, snapDistance: 80, wallRange: 450 };

export interface SnapObstacle {
  id: string;
  placement: Placement;
  extents: Extents;
}

export interface SnapGuide {
  a: Vec2;
  b: Vec2;
  kind: 'face' | 'contact' | 'align';
}

export interface SnapResult {
  placement: Placement;
  wallId: string | null;
  faceId: string | null;
  guides: SnapGuide[];
  /** Whether the result still overlaps another item. */
  colliding: boolean;
}

export interface SnapInput {
  extents: Extents;
  elevation: number;
  /** Where the user wants the footprint centre. */
  cursor: Vec2;
  /** Rotation to keep when the item is not attached to a wall. */
  rotation: number;
  faces: WallFace[];
  others: SnapObstacle[];
  settings: SnapSettings;
}

interface Interval {
  id: string;
  u0: number;
  u1: number;
}

const zOverlap = (e1: Extents, el1: number, e2: Extents, el2: number) => overlap1D(el1 + e1.z0, el1 + e1.z1, el2 + e2.z0, el2 + e2.z1) > 1;

/** Project obstacles that sit in the band [vMin, vMax] of a frame (origin, u axis, v axis) onto u. */
function intervalsInBand(
  origin: Vec2,
  uAxis: Vec2,
  vAxis: Vec2,
  vMin: number,
  vMax: number,
  input: SnapInput,
): Interval[] {
  const out: Interval[] = [];
  for (const o of input.others) {
    if (!zOverlap(input.extents, input.elevation, o.extents, o.placement.elevation)) continue;
    const pts = worldFootprint(o.placement, o.extents).map((p) => sub(p, origin));
    const us = pts.map((p) => dot(p, uAxis));
    const vs = pts.map((p) => dot(p, vAxis));
    if (overlap1D(vMin, vMax, Math.min(...vs), Math.max(...vs)) <= 1) continue;
    out.push({ id: o.id, u0: Math.min(...us), u1: Math.max(...us) });
  }
  return out;
}

const overlaps = (u0: number, u1: number, list: Interval[]) => list.some((iv) => overlap1D(u0, u1, iv.u0, iv.u1) > 0.5);

/** Pick the free position nearest `want` among candidates, or null. */
function nearestFree(want: number, width: number, candidates: number[], obstacles: Interval[], lo: number, hi: number): number | null {
  const sorted = [...new Set(candidates.map((c) => Math.round(c * 1000) / 1000))]
    .filter((c) => c >= lo - 0.01 && c + width <= hi + 0.01)
    .sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  for (const c of sorted) if (!overlaps(c, c + width, obstacles)) return c;
  return null;
}

function attachToFace(input: SnapInput, face: WallFace): SnapResult {
  const e = input.extents;
  const width = e.x1 - e.x0;
  const depth = e.y1 - e.y0;
  const n = face.normal;
  const xAxis: Vec2 = { x: -n.y, y: n.x };
  const rotation = Math.atan2(xAxis.y, xAxis.x);
  const uOf = (p: Vec2) => dot(sub(p, face.a), xAxis);
  const ub = uOf(face.b);
  const u0 = Math.min(0, ub);
  const u1 = Math.max(0, ub);
  const raw = uOf(input.cursor) - width / 2;
  const obstacles = intervalsInBand(face.a, xAxis, n, 0, depth, input);
  const guides: SnapGuide[] = [{ a: face.a, b: face.b, kind: 'face' }];

  let uL = raw;
  const ends = [u0, u1 - width];
  const contacts = obstacles.flatMap((o) => [o.u1, o.u0 - width]);
  let snapped = false;
  if (input.settings.items) {
    const cands = [...ends, ...contacts].filter((c) => Math.abs(c - raw) <= input.settings.snapDistance);
    cands.sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw));
    if (cands.length) {
      uL = cands[0];
      snapped = true;
    }
  }
  if (!snapped && input.settings.grid) uL = snapTo(raw, input.settings.gridSize, u0);
  if (width <= u1 - u0) uL = Math.min(Math.max(uL, u0), u1 - width);
  else uL = u0;

  let colliding = overlaps(uL, uL + width, obstacles);
  if (colliding) {
    const free = nearestFree(uL, width, [...ends, ...contacts], obstacles, u0, u1);
    if (free != null) {
      uL = free;
      colliding = false;
    }
  }
  for (const o of obstacles) {
    if (Math.abs(o.u1 - uL) < 0.5 || Math.abs(o.u0 - (uL + width)) < 0.5) {
      const u = Math.abs(o.u1 - uL) < 0.5 ? uL : uL + width;
      guides.push({ a: add(face.a, scale(xAxis, u)), b: add(add(face.a, scale(xAxis, u)), scale(n, depth)), kind: 'contact' });
    }
  }
  // Local point (x0, y1) — the back-left corner — sits on the face at uL.
  const origin = add(sub(add(face.a, scale(xAxis, uL)), scale(xAxis, e.x0)), scale(n, e.y1));
  return {
    placement: { x: origin.x, y: origin.y, rotation, elevation: input.elevation },
    wallId: face.wallId,
    faceId: face.id,
    guides,
    colliding,
  };
}

function freePlacement(input: SnapInput): SnapResult {
  const e = input.extents;
  const width = e.x1 - e.x0;
  const xAxis = fromAngle(input.rotation);
  const yAxis = perpLeft(xAxis);
  const centre = { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 };
  // Work in the item's rotated frame anchored at the world origin.
  let uL = dot(input.cursor, xAxis) - width / 2;
  let vF = dot(input.cursor, yAxis) - (e.y1 - e.y0) / 2;
  const guides: SnapGuide[] = [];
  let snappedU = false;
  let snappedV = false;
  if (input.settings.items) {
    let bestU = input.settings.snapDistance;
    let bestV = input.settings.snapDistance;
    for (const o of input.others) {
      if (angleDiff(o.placement.rotation, input.rotation) > 0.01) continue;
      if (!zOverlap(e, input.elevation, o.extents, o.placement.elevation)) continue;
      const pts = worldFootprint(o.placement, o.extents);
      const us = pts.map((p) => dot(p, xAxis));
      const vs = pts.map((p) => dot(p, yAxis));
      const ou0 = Math.min(...us);
      const ou1 = Math.max(...us);
      const ov0 = Math.min(...vs);
      const ov1 = Math.max(...vs);
      const depth = e.y1 - e.y0;
      // Side by side: butt edges.
      if (overlap1D(vF, vF + depth, ov0, ov1) > 1) {
        for (const c of [ou1, ou0 - width]) {
          const d = Math.abs(c - uL);
          if (d < bestU) {
            bestU = d;
            uL = c;
            snappedU = true;
          }
        }
      }
      // Align fronts and backs.
      for (const c of [ov0, ov1 - depth]) {
        const d = Math.abs(c - vF);
        if (d < bestV) {
          bestV = d;
          vF = c;
          snappedV = true;
        }
      }
    }
  }
  if (input.settings.grid) {
    if (!snappedU) uL = snapTo(uL, input.settings.gridSize);
    if (!snappedV) vF = snapTo(vF, input.settings.gridSize);
  }
  const corner = add(scale(xAxis, uL), scale(yAxis, vF)); // world position of local (x0, y0)
  const origin = sub(sub(corner, scale(xAxis, e.x0)), scale(yAxis, e.y0));
  const placement: Placement = { x: origin.x, y: origin.y, rotation: input.rotation, elevation: input.elevation };
  if (snappedV) {
    const f = frameOf(placement);
    const a = add(f.origin, add(scale(f.xAxis, e.x0 - 400), scale(f.yAxis, e.y0)));
    const b = add(f.origin, add(scale(f.xAxis, e.x1 + 400), scale(f.yAxis, e.y0)));
    guides.push({ a, b, kind: 'align' });
  }
  void centre;
  return { placement, wallId: null, faceId: null, guides, colliding: false };
}

export function snapItem(input: SnapInput): SnapResult {
  if (input.settings.walls) {
    const e = input.extents;
    const depth = e.y1 - e.y0;
    let best: { face: WallFace; score: number } | null = null;
    for (const f of input.faces) {
      if (f.length < 1) continue;
      const s = dot(sub(input.cursor, f.a), f.normal);
      if (s < -50 || s > depth / 2 + input.settings.wallRange) continue;
      const proj = projectOnSegment(input.cursor, f.a, f.b);
      const along = proj.t * f.length;
      if (along < -200 || along > f.length + 200) continue;
      const score = Math.abs(s - depth / 2);
      if (!best || score < best.score) best = { face: f, score };
    }
    if (best) return attachToFace(input, best.face);
  }
  return freePlacement(input);
}

// ───────────────────────────── Openings ─────────────────────────────

export interface OpeningSnap {
  wallId: string;
  offset: number;
}

export function snapOpening(cursor: Vec2, width: number, walls: Wall[], gridSize: number): OpeningSnap | null {
  let best: { wall: Wall; t: number; d: number } | null = null;
  for (const w of walls) {
    const p = projectOnSegment(cursor, w.start, w.end);
    if (p.distance > w.thickness / 2 + 600) continue;
    if (!best || p.distance < best.d) best = { wall: w, t: p.t, d: p.distance };
  }
  if (!best) return null;
  const len = distance(best.wall.start, best.wall.end);
  if (len < width) return null;
  let offset = best.t * len - width / 2;
  offset = snapTo(offset, gridSize);
  offset = Math.min(Math.max(offset, 0), len - width);
  return { wallId: best.wall.id, offset };
}

// ───────────────────────────── Wall drawing ─────────────────────────────

export interface WallPointSnap {
  point: Vec2;
  snappedToNode: boolean;
  angleLocked: boolean;
}

/** Snap a wall-drawing point to existing wall ends, 15° angle steps from the previous point, and the grid. */
export function snapWallPoint(cursor: Vec2, prev: Vec2 | null, walls: Wall[], gridSize: number, free = false): WallPointSnap {
  const nodes = walls.flatMap((w) => [w.start, w.end]);
  for (const n of nodes) if (distance(n, cursor) <= 150) return { point: { ...n }, snappedToNode: true, angleLocked: false };
  if (prev && !free) {
    const d = sub(cursor, prev);
    const len = Math.hypot(d.x, d.y);
    if (len > 1) {
      const step = Math.PI / 12;
      const ang = Math.round(Math.atan2(d.y, d.x) / step) * step;
      const l = snapTo(len, gridSize);
      const dir = fromAngle(ang);
      return { point: add(prev, scale(dir, l)), snappedToNode: false, angleLocked: true };
    }
  }
  return { point: { x: snapTo(cursor.x, gridSize), y: snapTo(cursor.y, gridSize) }, snappedToNode: false, angleLocked: false };
}

/** Next point at an exact typed length along the current drawing direction. */
export function pointAtLength(prev: Vec2, towards: Vec2, lengthMm: number): Vec2 {
  const dir = normalize(sub(towards, prev));
  const d = dir.x === 0 && dir.y === 0 ? { x: 1, y: 0 } : dir;
  return add(prev, scale(d, lengthMm));
}
