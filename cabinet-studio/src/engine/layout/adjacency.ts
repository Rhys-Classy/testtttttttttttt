// Automatic finished/unfinished ends: a cabinet side is "exposed" when nothing —
// another cabinet, a panel or a wall — covers it. Exposed ends are built in the front
// material so visible ends always match the doors.

import { boundsOf, pointInPolygon } from '../math/geometry2d';
import { localToWorld3, worldToLocal2 } from '../math/placement';
import type { Vec3 } from '../math/vec';
import type { CabinetItem, Item, Room } from '../model/types';
import type { WallGeometry } from '../room/walls';
import { bodyExtents, worldFootprint } from './extents';

export interface EndState {
  left: boolean;
  right: boolean;
  /** Whether each side is covered by something (independent of the user's override). */
  leftCovered: boolean;
  rightCovered: boolean;
}

const PROBE = 3; // mm outside the side face
const CELL = 1000; // spatial hash cell, mm

/** Uniform-grid spatial hash so cover tests stay O(n) for large rooms. */
class ItemGrid {
  private cells = new Map<string, Item[]>();
  constructor(items: Item[]) {
    for (const it of items) {
      const b = boundsOf(worldFootprint(it.placement, bodyExtents(it)));
      for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) {
        for (let cy = Math.floor(b.minY / CELL); cy <= Math.floor(b.maxY / CELL); cy++) {
          const k = `${cx},${cy}`;
          const list = this.cells.get(k);
          if (list) list.push(it);
          else this.cells.set(k, [it]);
        }
      }
    }
  }
  at(p: { x: number; y: number }): Item[] {
    return this.cells.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? [];
  }
}

function pointCovered(w: Vec3, selfId: string, grid: ItemGrid, walls: WallGeometry[]): boolean {
  for (const o of grid.at(w)) {
    if (o.id === selfId) continue;
    const e = bodyExtents(o);
    const zl = w.z - o.placement.elevation;
    if (zl < e.z0 || zl > e.z1) continue;
    const l = worldToLocal2(o.placement, w);
    if (l.x >= e.x0 - 0.5 && l.x <= e.x1 + 0.5 && l.y >= e.y0 - 0.5 && l.y <= e.y1 + 0.5) return true;
  }
  for (const g of walls) if (w.z <= g.wall.height && pointInPolygon(w, g.outline)) return true;
  return false;
}

function covered(cab: CabinetItem, side: 'left' | 'right', grid: ItemGrid, walls: WallGeometry[]): boolean {
  const p = cab.params;
  const x = side === 'left' ? -PROBE : p.width + PROBE;
  const zs = [p.kickHeight + (p.height - p.kickHeight) * 0.3, p.kickHeight + (p.height - p.kickHeight) * 0.7];
  const ys = [p.depth * 0.2, p.depth * 0.5, p.depth * 0.8];
  let hits = 0;
  for (const y of ys) for (const z of zs) if (pointCovered(localToWorld3(cab.placement, { x, y, z }), cab.id, grid, walls)) hits++;
  return hits >= Math.ceil(ys.length * zs.length * 0.6);
}

export function resolveEnds(room: Room, walls: Map<string, WallGeometry>): Map<string, EndState> {
  const out = new Map<string, EndState>();
  const wallList = [...walls.values()];
  const grid = new ItemGrid(room.items);
  for (const it of room.items) {
    if (it.kind !== 'cabinet') continue;
    const leftCovered = covered(it, 'left', grid, wallList);
    const rightCovered = covered(it, 'right', grid, wallList);
    const mode = it.params.ends;
    out.set(it.id, {
      left: mode.left === 'auto' ? !leftCovered : mode.left === 'finished',
      right: mode.right === 'auto' ? !rightCovered : mode.right === 'finished',
      leftCovered,
      rightCovered,
    });
  }
  return out;
}
