import { clipConvexByHalfPlane, lineIntersection, polygonArea } from '../math/geometry2d';
import { add, distance, dot, normalize, perpLeft, perpRight, scale, sub, type Vec2 } from '../math/vec';
import { newId } from '../model/ids';
import type { Opening, Room, Wall } from '../model/types';

const NODE_TOL = 1; // mm — wall ends closer than this are joined

export interface WallFace {
  /** `${wallId}:L` or `${wallId}:R` */
  id: string;
  wallId: string;
  side: 'left' | 'right';
  a: Vec2;
  b: Vec2;
  /** Unit normal pointing away from the wall into the space on this side. */
  normal: Vec2;
  length: number;
}

export interface WallGeometry {
  wall: Wall;
  dir: Vec2;
  length: number;
  left: WallFace;
  right: WallFace;
  /** Plan outline of the wall prism (counter-clockwise), mitred at joints. */
  outline: Vec2[];
}

const near = (a: Vec2, b: Vec2) => distance(a, b) <= NODE_TOL;

interface FaceLine {
  p: Vec2;
  d: Vec2;
}

function faceLine(w: Wall, side: 'left' | 'right'): FaceLine {
  const d = normalize(sub(w.end, w.start));
  const n = side === 'left' ? perpLeft(d) : perpRight(d);
  return { p: add(w.start, scale(n, w.thickness / 2)), d };
}

/**
 * For the end of `w` at node P, find the face line of the neighbouring wall that
 * continues `side` of `w` through the joint. Returns null at free ends and T-junctions.
 */
function neighbourFace(w: Wall, walls: Wall[], end: 'start' | 'end', side: 'left' | 'right'): FaceLine | null {
  const P = end === 'start' ? w.start : w.end;
  const others = walls.filter((o) => o.id !== w.id && (near(o.start, P) || near(o.end, P)));
  if (others.length !== 1) return null;
  const o = others[0];
  // Walking along w (start→end) and continuing into o: if o runs the same way through
  // the node, sides correspond; if o is drawn the other way, left and right swap.
  const sameOrientation = end === 'end' ? near(o.start, P) : near(o.end, P);
  const oSide = sameOrientation ? side : side === 'left' ? 'right' : 'left';
  return faceLine(o, oSide);
}

function trimmedFace(w: Wall, walls: Wall[], side: 'left' | 'right'): { a: Vec2; b: Vec2 } {
  const own = faceLine(w, side);
  const len = distance(w.start, w.end);
  const off = scale(side === 'left' ? perpLeft(own.d) : perpRight(own.d), w.thickness / 2);
  let a = add(w.start, off);
  let b = add(w.end, off);
  const limit = Math.max(w.thickness, 1) * 6;
  const s = neighbourFace(w, walls, 'start', side);
  if (s) {
    const x = lineIntersection(own.p, own.d, s.p, s.d);
    if (x && distance(x, a) < limit && dot(sub(x, a), own.d) < len) a = x;
  }
  const e = neighbourFace(w, walls, 'end', side);
  if (e) {
    const x = lineIntersection(own.p, own.d, e.p, e.d);
    if (x && distance(x, b) < limit && dot(sub(b, x), own.d) < len) b = x;
  }
  return { a, b };
}

export function wallGeometry(w: Wall, walls: Wall[]): WallGeometry {
  const dir = normalize(sub(w.end, w.start));
  const length = distance(w.start, w.end);
  const L = trimmedFace(w, walls, 'left');
  const R = trimmedFace(w, walls, 'right');
  const left: WallFace = { id: `${w.id}:L`, wallId: w.id, side: 'left', a: L.a, b: L.b, normal: perpLeft(dir), length: distance(L.a, L.b) };
  const right: WallFace = { id: `${w.id}:R`, wallId: w.id, side: 'right', a: R.a, b: R.b, normal: perpRight(dir), length: distance(R.a, R.b) };
  return { wall: w, dir, length, left, right, outline: [R.a, R.b, L.b, L.a] };
}

export function computeWalls(walls: Wall[]): Map<string, WallGeometry> {
  const m = new Map<string, WallGeometry>();
  for (const w of walls) if (distance(w.start, w.end) > NODE_TOL) m.set(w.id, wallGeometry(w, walls));
  return m;
}

export function allFaces(geoms: Map<string, WallGeometry>): WallFace[] {
  const out: WallFace[] = [];
  for (const g of geoms.values()) out.push(g.left, g.right);
  return out;
}

/**
 * If the walls form one closed loop, returns the centre-line polygon (counter-clockwise)
 * and the ids of the faces that look into the room.
 */
export function roomLoop(walls: Wall[]): { polygon: Vec2[]; interiorFaceIds: Set<string> } | null {
  if (walls.length < 3) return null;
  const remaining = [...walls];
  const first = remaining.shift()!;
  const chain: { wall: Wall; forward: boolean }[] = [{ wall: first, forward: true }];
  let cursor = first.end;
  while (remaining.length) {
    const idx = remaining.findIndex((w) => near(w.start, cursor) || near(w.end, cursor));
    if (idx < 0) return null;
    const w = remaining.splice(idx, 1)[0];
    const forward = near(w.start, cursor);
    chain.push({ wall: w, forward });
    cursor = forward ? w.end : w.start;
  }
  if (!near(cursor, first.start)) return null;
  const polygon = chain.map((c) => (c.forward ? c.wall.start : c.wall.end));
  const ccw = polygonArea(polygon) > 0;
  const interiorFaceIds = new Set<string>();
  for (const c of chain) {
    // Interior is on the left of the walking direction for a CCW loop.
    const leftOfWalk = ccw;
    const side = c.forward === leftOfWalk ? 'L' : 'R';
    interiorFaceIds.add(`${c.wall.id}:${side}`);
  }
  return { polygon: ccw ? polygon : [...polygon].reverse(), interiorFaceIds };
}

export interface WallPiece {
  /** Plan polygon (convex). */
  polygon: Vec2[];
  z0: number;
  z1: number;
}

/** Split a wall prism into solid pieces around its openings (for rendering and drawings). */
export function wallPieces(g: WallGeometry, openings: Opening[]): WallPiece[] {
  const w = g.wall;
  const H = w.height;
  const base = dot(w.start, g.dir);
  const clip = (lo: number, hi: number): Vec2[] => {
    let poly = g.outline;
    if (Number.isFinite(lo)) poly = clipConvexByHalfPlane(poly, g.dir, base + lo);
    if (Number.isFinite(hi)) poly = clipConvexByHalfPlane(poly, scale(g.dir, -1), -(base + hi));
    return poly;
  };
  const ops = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => ({ o, u0: Math.max(0, o.offset), u1: Math.min(g.length, o.offset + o.width) }))
    .filter((x) => x.u1 - x.u0 > 1)
    .sort((a, b) => a.u0 - b.u0);
  const pieces: WallPiece[] = [];
  let cursor = -Infinity;
  for (const { o, u0, u1 } of ops) {
    if (u0 < cursor) continue; // overlapping openings: ignore the later one
    const solid = clip(cursor, u0);
    if (solid.length >= 3) pieces.push({ polygon: solid, z0: 0, z1: H });
    const span = clip(u0, u1);
    if (span.length >= 3) {
      if (o.sill > 0) pieces.push({ polygon: span, z0: 0, z1: Math.min(H, o.sill) });
      const head = o.sill + o.height;
      if (head < H) pieces.push({ polygon: span, z0: head, z1: H });
    }
    cursor = u1;
  }
  const rest = clip(cursor, Infinity);
  if (rest.length >= 3) pieces.push({ polygon: rest, z0: 0, z1: H });
  return pieces;
}

/** Interior dimensions are clear (finished face to face). Walls are drawn counter-clockwise. */
export function rectangularWalls(width: number, depth: number, height: number, thickness: number): Wall[] {
  const h = thickness / 2;
  const c = [
    { x: -h, y: -h },
    { x: width + h, y: -h },
    { x: width + h, y: depth + h },
    { x: -h, y: depth + h },
  ];
  return c.map((p, i) => ({ id: newId('wall'), start: p, end: c[(i + 1) % 4], thickness, height }));
}

export function createRoom(name: string, width: number, depth: number, height: number, thickness = 110): Room {
  return {
    id: newId('room'),
    name,
    ceilingHeight: height,
    walls: rectangularWalls(width, depth, height, thickness),
    openings: [],
    items: [],
    floorMaterialId: 'floor-oak-boards',
    wallMaterialId: 'wall-paint-white',
  };
}

export function wallLength(w: Wall): number {
  return distance(w.start, w.end);
}
