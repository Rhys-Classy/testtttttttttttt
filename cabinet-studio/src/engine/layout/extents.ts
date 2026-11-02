import { footprint, type Placement } from '../math/placement';
import type { Vec2 } from '../math/vec';
import type { Item } from '../model/types';

/** Item-local bounding extents (mm) used for snapping and collision. */
export interface Extents {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * Footprint including fronts. `frontProjection` is how far fronts stand proud of the
 * carcass (front thickness for overlay fronts, 0 for inset).
 */
export function itemExtents(item: Item, frontProjection: number): Extents {
  if (item.kind === 'cabinet') {
    const p = item.params;
    return { x0: 0, x1: p.width, y0: -frontProjection, y1: p.depth, z0: 0, z1: p.height };
  }
  return { x0: 0, x1: item.width, y0: 0, y1: item.depth, z0: 0, z1: item.height };
}

/** Carcass/body only (no fronts) — what physically covers a neighbour's side. */
export function bodyExtents(item: Item): Extents {
  if (item.kind === 'cabinet') {
    const p = item.params;
    return { x0: 0, x1: p.width, y0: 0, y1: p.depth, z0: 0, z1: p.height };
  }
  return { x0: 0, x1: item.width, y0: 0, y1: item.depth, z0: 0, z1: item.height };
}

export function worldFootprint(p: Placement, e: Extents): Vec2[] {
  return footprint(p, e.x0, e.y0, e.x1, e.y1);
}
