// Geometry builders: engine data (mm, Z-up) → three.js objects (metres, Y-up).
//
// Mapping: engine (x, y, z) → three (x, z, −y) × 0.001. A placement's rotation about
// engine +Z equals rotation about three +Y, so item groups use rotation.y = rotation.
//
// Parts are merged per material into one BufferGeometry per item, so a cabinet with
// thirty parts costs ~3 draw calls; geometry is rebuilt only when that item changes.

import * as THREE from 'three/webgpu';
import type { Axis, HardwareVisual, Id, ItemBuild, MaterialDef, Opening, Part, PartBox, Placement, Vec2, WallGeometry, WallPiece } from '@engine/index';
import type { MaterialCache } from './materials3d';

export const S = 0.001;

export const toThree = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x * S, z * S, -y * S);
export const fromThree = (v: THREE.Vector3): { x: number; y: number; z: number } => ({ x: v.x / S, y: -v.z / S, z: v.y / S });

export function applyPlacement(obj: THREE.Object3D, p: Placement): void {
  obj.position.set(p.x * S, p.elevation * S, -p.y * S);
  obj.rotation.set(0, p.rotation, 0);
}

// three axis index for an engine axis
const T_AXIS: Record<Axis, number> = { x: 0, y: 2, z: 1 };

interface Arrays {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

const newArrays = (): Arrays => ({ pos: [], nrm: [], uv: [], idx: [] });

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Append an engine-local box. `grain` = engine axis the texture V follows. */
export function appendBox(a: Arrays, b: PartBox, grain: Axis = 'z', uvSeed = 0): void {
  const min = [b.x * S, b.z * S, -(b.y + b.sy) * S];
  const max = [(b.x + b.sx) * S, (b.z + b.sz) * S, -b.y * S];
  const g = T_AXIS[grain];
  const off = uvSeed * 3.7;
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const u = sign > 0 ? (axis + 1) % 3 : (axis + 2) % 3;
      const v = sign > 0 ? (axis + 2) % 3 : (axis + 1) % 3;
      const base = a.pos.length / 3;
      const corners: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      // Texture V runs along the grain axis when it lies in this face.
      const texV = g !== axis ? g : v;
      const texU = [0, 1, 2].find((k) => k !== axis && k !== texV)!;
      for (const [cu, cv] of corners) {
        const p = [0, 0, 0];
        p[axis] = sign > 0 ? max[axis] : min[axis];
        p[u] = cu ? max[u] : min[u];
        p[v] = cv ? max[v] : min[v];
        a.pos.push(p[0], p[1], p[2]);
        const n = [0, 0, 0];
        n[axis] = sign;
        a.nrm.push(n[0], n[1], n[2]);
        a.uv.push(p[texU] + off, p[texV] + off * 0.37);
      }
      a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

function toGeometry(a: Arrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function boxEdges(boxes: PartBox[]): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const b of boxes) {
    const x = [b.x * S, (b.x + b.sx) * S];
    const y = [b.z * S, (b.z + b.sz) * S];
    const z = [-(b.y + b.sy) * S, -b.y * S];
    const c = (i: number, j: number, k: number) => [x[i], y[j], z[k]];
    const e: [number[], number[]][] = [
      [c(0, 0, 0), c(1, 0, 0)], [c(0, 1, 0), c(1, 1, 0)], [c(0, 0, 1), c(1, 0, 1)], [c(0, 1, 1), c(1, 1, 1)],
      [c(0, 0, 0), c(0, 1, 0)], [c(1, 0, 0), c(1, 1, 0)], [c(0, 0, 1), c(0, 1, 1)], [c(1, 0, 1), c(1, 1, 1)],
      [c(0, 0, 0), c(0, 0, 1)], [c(1, 0, 0), c(1, 0, 1)], [c(0, 1, 0), c(0, 1, 1)], [c(1, 1, 0), c(1, 1, 1)],
    ];
    for (const [p, q] of e) pts.push(...p, ...q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export interface PickInfo {
  kind: 'item' | 'wall' | 'opening' | 'handle';
  id: Id;
  handle?: 'width-left' | 'width-right' | 'height';
}

export interface ItemObject {
  group: THREE.Group;
  edges: THREE.LineSegments | null;
  pickables: THREE.Object3D[];
  dispose: () => void;
}

function hardwareBoxes(v: HardwareVisual): PartBox[] {
  const c = v.center;
  if (v.kind === 'knob') return [{ x: c.x - 14, y: c.y - 8, z: c.z - 14, sx: 28, sy: 22, sz: 28 }];
  if (v.kind === 'tube') return [{ x: c.x - v.length / 2, y: c.y - 8, z: c.z - 15, sx: v.length, sy: 16, sz: 30 }];
  // Bar handle: grip 12 × 12 at 28 mm stand-off plus two posts at the hole centres.
  const grip = v.length + 40;
  const boxes: PartBox[] = [];
  if (v.axis === 'x') {
    boxes.push({ x: c.x - grip / 2, y: c.y - 20, z: c.z - 6, sx: grip, sy: 12, sz: 12 });
    for (const dx of [-v.length / 2, v.length / 2]) boxes.push({ x: c.x + dx - 5, y: c.y - 8, z: c.z - 5, sx: 10, sy: 22, sz: 10 });
  } else {
    boxes.push({ x: c.x - 6, y: c.y - 20, z: c.z - grip / 2, sx: 12, sy: 12, sz: grip });
    for (const dz of [-v.length / 2, v.length / 2]) boxes.push({ x: c.x - 5, y: c.y - 8, z: c.z + dz - 5, sx: 10, sy: 22, sz: 10 });
  }
  return boxes;
}

export function buildItemObject(
  build: ItemBuild,
  placement: Placement,
  materials: ReadonlyMap<Id, MaterialDef>,
  cache: MaterialCache,
  handleMaterialId: Id,
  opts: { shadows: boolean; edges: boolean },
): ItemObject {
  const group = new THREE.Group();
  group.name = `item:${build.itemId}`;
  applyPlacement(group, placement);
  const pick: PickInfo = { kind: 'item', id: build.itemId };
  const geoms: THREE.BufferGeometry[] = [];
  const pickables: THREE.Object3D[] = [];

  if (build.invalid) {
    const g = toGeometry((() => {
      const a = newArrays();
      appendBox(a, build.bounds);
      return a;
    })());
    geoms.push(g);
    const m = new THREE.Mesh(g, cache.invalid);
    m.userData.pick = pick;
    group.add(m);
    pickables.push(m);
    return { group, edges: null, pickables, dispose: () => geoms.forEach((x) => x.dispose()) };
  }

  const byMat = new Map<Id, Part[]>();
  for (const p of build.parts) {
    const list = byMat.get(p.materialId);
    if (list) list.push(p);
    else byMat.set(p.materialId, [p]);
  }
  for (const [mid, parts] of byMat) {
    const a = newArrays();
    for (const p of parts) appendBox(a, p.box, p.lengthAxis, hash01(p.id));
    const g = toGeometry(a);
    geoms.push(g);
    const mesh = new THREE.Mesh(g, cache.get(materials.get(mid)));
    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = opts.shadows;
    mesh.userData.pick = pick;
    group.add(mesh);
    pickables.push(mesh);
  }

  const hw = build.hardware.filter((h) => h.visual);
  if (hw.length) {
    const a = newArrays();
    for (const h of hw) for (const b of hardwareBoxes(h.visual!)) appendBox(a, b, h.visual!.axis);
    const g = toGeometry(a);
    geoms.push(g);
    const mesh = new THREE.Mesh(g, cache.get(materials.get(handleMaterialId)));
    mesh.castShadow = opts.shadows;
    mesh.userData.pick = pick;
    group.add(mesh);
    pickables.push(mesh);
  }

  for (const ap of build.appliances) {
    const a = newArrays();
    const b = ap.box;
    appendBox(a, { x: b.x + 2, y: b.y - 20, z: b.z + 2, sx: b.sx - 4, sy: Math.min(b.sy - 40, 560), sz: b.sz - 4 });
    const g = toGeometry(a);
    geoms.push(g);
    const mesh = new THREE.Mesh(g, cache.appliance);
    mesh.userData.pick = pick;
    group.add(mesh);
    pickables.push(mesh);
  }

  let edges: THREE.LineSegments | null = null;
  if (opts.edges) {
    const eg = boxEdges(build.parts.map((p) => p.box));
    geoms.push(eg);
    edges = new THREE.LineSegments(eg, cache.edge);
    edges.renderOrder = 1;
    group.add(edges);
  }
  return { group, edges, pickables, dispose: () => geoms.forEach((x) => x.dispose()) };
}

/** Selection outline + resize handles for the selected item. */
export function buildSelectionObject(build: ItemBuild, placement: Placement, cache: MaterialCache): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  applyPlacement(group, placement);
  const b = build.bounds;
  const outline = new THREE.LineSegments(boxEdges([{ x: b.x - 2, y: b.y - 2, z: b.z - 2, sx: b.sx + 4, sy: b.sy + 4, sz: b.sz + 4 }]), cache.edgeSelected);
  outline.renderOrder = 10;
  group.add(outline);
  const sphere = new THREE.SphereGeometry(0.03, 20, 12);
  const handles: [PickInfo['handle'], number, number, number][] = [
    ['width-left', b.x - 60, b.y, b.z + b.sz / 2],
    ['width-right', b.x + b.sx + 60, b.y, b.z + b.sz / 2],
    ['height', b.x + b.sx / 2, b.y, b.z + b.sz + 60],
  ];
  for (const [h, x, y, z] of handles) {
    const m = new THREE.Mesh(sphere, cache.handle);
    m.position.copy(toThree(x, y, z));
    m.renderOrder = 11;
    m.userData.pick = { kind: 'handle', id: build.itemId, handle: h } satisfies PickInfo;
    group.add(m);
  }
  return {
    group,
    dispose: () => {
      outline.geometry.dispose();
      sphere.dispose();
    },
  };
}

// ───────────────────────────── Walls, floor, openings ─────────────────────────────

/** Extrude a convex/concave plan polygon between heights (mm). */
export function extrudePolygon(poly: Vec2[], z0: number, z1: number): THREE.BufferGeometry {
  const a = newArrays();
  const area = poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0);
  const ring = area < 0 ? [...poly].reverse() : poly;
  const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.y)), []);
  const cap = (z: number, up: boolean) => {
    const base = a.pos.length / 3;
    for (const p of ring) {
      a.pos.push(p.x * S, z * S, -p.y * S);
      a.nrm.push(0, up ? 1 : -1, 0);
      a.uv.push(p.x * S, p.y * S);
    }
    for (const t of tris) {
      if (up) a.idx.push(base + t[0], base + t[1], base + t[2]);
      else a.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  };
  cap(z1, true);
  cap(z0, false);
  let along = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-6) continue;
    // Outward normal of a CCW ring edge in plan is perpRight(dir).
    const nx = (q.y - p.y) / len;
    const ny = -(q.x - p.x) / len;
    const base = a.pos.length / 3;
    const verts = [
      [p, z0],
      [q, z0],
      [q, z1],
      [p, z1],
    ] as const;
    verts.forEach(([v, z], k) => {
      a.pos.push(v.x * S, z * S, -v.y * S);
      a.nrm.push(nx, 0, -ny);
      a.uv.push((along + (k === 1 || k === 2 ? len : 0)) * S, z * S);
    });
    along += len;
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return toGeometry(a);
}

export function wallObject(g: WallGeometry, pieces: WallPiece[], mat: THREE.Material, shadows: boolean): { group: THREE.Group; meshes: THREE.Mesh[]; dispose: () => void } {
  const group = new THREE.Group();
  group.name = `wall:${g.wall.id}`;
  const geoms: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[] = [];
  for (const p of pieces) {
    const geo = extrudePolygon(p.polygon, p.z0, p.z1);
    geoms.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    m.userData.pick = { kind: 'wall', id: g.wall.id } satisfies PickInfo;
    group.add(m);
    meshes.push(m);
  }
  return { group, meshes, dispose: () => geoms.forEach((x) => x.dispose()) };
}

export function openingObject(
  o: Opening,
  g: WallGeometry,
  frame: THREE.Material,
  glass: THREE.Material,
  leaf: THREE.Material,
): { group: THREE.Group; pickables: THREE.Object3D[]; dispose: () => void } {
  const w = g.wall;
  const t = w.thickness;
  const start = { x: w.start.x + g.dir.x * o.offset, y: w.start.y + g.dir.y * o.offset };
  const group = new THREE.Group();
  applyPlacement(group, { x: start.x, y: start.y, rotation: Math.atan2(g.dir.y, g.dir.x), elevation: 0 });
  const frameBoxes: PartBox[] = [];
  const glassBoxes: PartBox[] = [];
  const leafBoxes: PartBox[] = [];
  const W = o.width;
  const z0 = o.sill;
  const H = o.height;
  if (o.kind === 'window') {
    const f = 50;
    const d = Math.min(70, t);
    frameBoxes.push(
      { x: 0, y: -d / 2, z: z0, sx: f, sy: d, sz: H },
      { x: W - f, y: -d / 2, z: z0, sx: f, sy: d, sz: H },
      { x: f, y: -d / 2, z: z0 + H - f, sx: W - 2 * f, sy: d, sz: f },
      { x: f, y: -d / 2, z: z0, sx: W - 2 * f, sy: d, sz: f },
    );
    if (W > 1400) frameBoxes.push({ x: W / 2 - f / 2, y: -d / 2, z: z0 + f, sx: f, sy: d, sz: H - 2 * f });
    glassBoxes.push({ x: f, y: -3, z: z0 + f, sx: W - 2 * f, sy: 6, sz: H - 2 * f });
    // Sill board on the room side.
    frameBoxes.push({ x: -20, y: t / 2, z: z0 - 20, sx: W + 40, sy: 30, sz: 20 });
  } else {
    const f = 40;
    const d = t + 10;
    frameBoxes.push(
      { x: 0, y: -d / 2, z: 0, sx: f, sy: d, sz: H },
      { x: W - f, y: -d / 2, z: 0, sx: f, sy: d, sz: H },
      { x: 0, y: -d / 2, z: H - f, sx: W, sy: d, sz: f },
    );
    leafBoxes.push({ x: f + 2, y: -20, z: 8, sx: W - 2 * f - 4, sy: 38, sz: H - f - 10 });
  }
  const geoms: THREE.BufferGeometry[] = [];
  const pickables: THREE.Object3D[] = [];
  const add = (boxes: PartBox[], mat: THREE.Material) => {
    if (!boxes.length) return;
    const a = newArrays();
    for (const b of boxes) appendBox(a, b, 'z');
    const geo = toGeometry(a);
    geoms.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.userData.pick = { kind: 'opening', id: o.id } satisfies PickInfo;
    m.castShadow = mat !== glass;
    group.add(m);
    pickables.push(m);
  };
  add(frameBoxes, frame);
  add(glassBoxes, glass);
  add(leafBoxes, leaf);
  return { group, pickables, dispose: () => geoms.forEach((x) => x.dispose()) };
}

export function lineObject(points: { x: number; y: number; z: number }[], mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const pts: number[] = [];
  for (const p of points) pts.push(p.x * S, p.z * S, -p.y * S);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, mat);
  l.renderOrder = 20;
  return l;
}
