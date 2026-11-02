import { fromAngle, perpLeft, type Vec2, type Vec3 } from './vec';

/**
 * Where an item sits in the room (plan coordinates, mm).
 *
 * Item-local frame (right-handed, same for every product):
 *   origin = front-left-bottom corner of the item's body (carcass), when facing its front
 *   +x     = to the viewer's right (width)
 *   +y     = from the front towards the back (depth)
 *   +z     = up (height)
 * Fronts (doors, drawer fronts) therefore sit at negative y.
 *
 * World/plan frame: +x east, +y north, +z up. `rotation` turns the local x axis
 * counter-clockwise from world +x.
 */
export interface Placement {
  x: number;
  y: number;
  /** Radians, counter-clockwise. */
  rotation: number;
  /** Height of the item's local z = 0 above the floor. */
  elevation: number;
}

export interface Frame {
  origin: Vec2;
  xAxis: Vec2;
  yAxis: Vec2;
}

export function frameOf(p: Placement): Frame {
  const xAxis = fromAngle(p.rotation);
  return { origin: { x: p.x, y: p.y }, xAxis, yAxis: perpLeft(xAxis) };
}

export function localToWorld2(p: Placement, local: Vec2): Vec2 {
  const f = frameOf(p);
  return {
    x: f.origin.x + f.xAxis.x * local.x + f.yAxis.x * local.y,
    y: f.origin.y + f.xAxis.y * local.x + f.yAxis.y * local.y,
  };
}

export function worldToLocal2(p: Placement, world: Vec2): Vec2 {
  const f = frameOf(p);
  const dx = world.x - f.origin.x;
  const dy = world.y - f.origin.y;
  return { x: dx * f.xAxis.x + dy * f.xAxis.y, y: dx * f.yAxis.x + dy * f.yAxis.y };
}

export function localToWorld3(p: Placement, local: Vec3): Vec3 {
  const w = localToWorld2(p, local);
  return { x: w.x, y: w.y, z: p.elevation + local.z };
}

/** Plan footprint corners (counter-clockwise) of a local rectangle [x0,x1]×[y0,y1]. */
export function footprint(p: Placement, x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    localToWorld2(p, { x: x0, y: y0 }),
    localToWorld2(p, { x: x1, y: y0 }),
    localToWorld2(p, { x: x1, y: y1 }),
    localToWorld2(p, { x: x0, y: y1 }),
  ];
}
