// Clash detection between items (footprint + height range). Touching is fine; any real
// interpenetration beyond the tolerance is reported so overlapping cabinets never reach
// the workshop unnoticed.

import { overlap1D } from '../math/geometry2d';
import { dot, sub, type Vec2 } from '../math/vec';
import type { Item, Room } from '../model/types';
import { worldFootprint, type Extents } from './extents';

/** Separating-axis test for two convex polygons; true when they overlap by more than `tol` mm. */
export function convexOverlap(a: Vec2[], b: Vec2[], tol = 0.5): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const e = sub(q, p);
      const len = Math.hypot(e.x, e.y);
      if (len < 1e-9) continue;
      const n = { x: -e.y / len, y: e.x / len };
      const pa = a.map((v) => dot(v, n));
      const pb = b.map((v) => dot(v, n));
      if (overlap1D(Math.min(...pa), Math.max(...pa), Math.min(...pb), Math.max(...pb)) <= tol) return false;
    }
  }
  return true;
}

export function itemsClash(a: Item, ea: Extents, b: Item, eb: Extents, tol = 0.5): boolean {
  const za = [a.placement.elevation + ea.z0, a.placement.elevation + ea.z1];
  const zb = [b.placement.elevation + eb.z0, b.placement.elevation + eb.z1];
  if (overlap1D(za[0], za[1], zb[0], zb[1]) <= tol) return false;
  return convexOverlap(worldFootprint(a.placement, ea), worldFootprint(b.placement, eb), tol);
}

/** Items that clash with `id`. */
export function clashesWith(room: Room, id: string, extentsOf: (i: Item) => Extents): Item[] {
  const me = room.items.find((i) => i.id === id);
  if (!me) return [];
  const em = extentsOf(me);
  return room.items.filter((o) => o.id !== id && itemsClash(me, em, o, extentsOf(o)));
}
