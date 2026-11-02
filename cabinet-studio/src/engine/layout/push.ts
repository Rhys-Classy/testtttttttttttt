// "Push to obstacle": slide an item along its own x axis until it is hard up against the
// nearest item, wall or opening clearance zone. Pure function on plan data.

import { activeRoom, findItem, updateItem } from '../document/commands';
import { Deriver } from '../document/derive';
import { overlap1D } from '../math/geometry2d';
import { add, dot, fromAngle, perpLeft, scale, type Vec2 } from '../math/vec';
import type { ProjectDocument } from '../model/types';
import { computeWalls } from '../room/walls';
import { worldFootprint } from './extents';

export type PushDirection = 'left' | 'right';
export interface PushResult {
  doc: ProjectDocument;
  distance: number;
}

/** Clearance (mm) either side of a wall face that an opening keeps free. */
const OPENING_CLEARANCE = 600;

const deriver = new Deriver();

/** Slide an item along its own x axis until it is hard up against the nearest obstacle. */
export function pushItem(doc: ProjectDocument, itemId: string, dir: PushDirection, gap = 0): PushResult | null {
  const item = findItem(doc, itemId);
  if (!item) return null;
  const room = activeRoom(doc);
  const X = fromAngle(item.placement.rotation);
  const Y = perpLeft(X);
  const ext = deriver.extents(doc, item);
  const z0 = item.placement.elevation + ext.z0;
  const z1 = item.placement.elevation + ext.z1;

  const range = (pts: Vec2[], axis: Vec2): [number, number] => {
    const s = pts.map((p) => dot(p, axis));
    return [Math.min(...s), Math.max(...s)];
  };
  const self = worldFootprint(item.placement, ext);
  const [iu0, iu1] = range(self, X);
  const [v0, v1] = range(self, Y);

  const obstacles: { u0: number; u1: number }[] = [];
  const consider = (pts: Vec2[], oz0: number, oz1: number) => {
    if (overlap1D(z0, z1, oz0, oz1) <= 1) return;
    const [ov0, ov1] = range(pts, Y);
    if (overlap1D(v0, v1, ov0, ov1) <= 1) return;
    const [u0, u1] = range(pts, X);
    obstacles.push({ u0, u1 });
  };

  for (const o of room.items) {
    if (o.id === item.id) continue;
    const e = deriver.extents(doc, o);
    consider(worldFootprint(o.placement, e), o.placement.elevation + e.z0, o.placement.elevation + e.z1);
  }

  const geoms = computeWalls(room.walls);
  for (const g of geoms.values()) consider(g.outline, 0, g.wall.height || room.ceilingHeight);

  for (const op of room.openings) {
    const g = geoms.get(op.wallId);
    if (!g) continue;
    const half = g.wall.thickness / 2 + OPENING_CLEARANCE;
    const n = perpLeft(g.dir);
    const a = add(g.wall.start, scale(g.dir, op.offset));
    const b = add(a, scale(g.dir, op.width));
    const zone = [add(a, scale(n, half)), add(b, scale(n, half)), add(b, scale(n, -half)), add(a, scale(n, -half))];
    consider(zone, op.sill, op.sill + op.height);
  }

  let distance: number;
  if (dir === 'right') {
    const ahead = obstacles.filter((o) => o.u0 >= iu1 - 0.5);
    if (!ahead.length) return null;
    distance = Math.min(...ahead.map((o) => o.u0)) - iu1 - gap;
  } else {
    const ahead = obstacles.filter((o) => o.u1 <= iu0 + 0.5);
    if (!ahead.length) return null;
    distance = iu0 - Math.max(...ahead.map((o) => o.u1)) - gap;
  }
  if (distance < 0.5) return { doc, distance: 0 };

  const d = dir === 'right' ? distance : -distance;
  return {
    doc: updateItem(doc, itemId, (i) => ({ ...i, placement: { ...i.placement, x: i.placement.x + X.x * d, y: i.placement.y + X.y * d } })),
    distance,
  };
}
