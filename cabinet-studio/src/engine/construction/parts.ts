// Manufacturing parts. Every product is decomposed into these; rendering, drawings,
// cutlists and (later) CNC output all read the same Part records.

import type { HardwareType } from '../library/hardware';
import type { Vec2, Vec3 } from '../math/vec';
import type { FrontProfile, HingeSide, Id, MaterialSlot } from '../model/types';

export type Axis = 'x' | 'y' | 'z';

/** Axis-aligned box in item-local coordinates: min corner + size (mm). */
export interface PartBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

/** Physical edge of a panel: the box face at the min (0) or max (1) end of an axis. */
export type EdgeId = 'x0' | 'x1' | 'y0' | 'y1' | 'z0' | 'z1';

export type PartRole =
  | 'side'
  | 'bottom'
  | 'top'
  | 'rail'
  | 'back'
  | 'shelf'
  | 'fixed-shelf'
  | 'door'
  | 'drawer-front'
  | 'blind-panel'
  | 'kick'
  | 'drawer-side'
  | 'drawer-sub-front'
  | 'drawer-back'
  | 'drawer-bottom'
  | 'end-panel'
  | 'filler-face'
  | 'filler-return'
  | 'benchtop'
  | 'splashback';

/**
 * Banding in cutlist convention: L1/L2 are the two long edges (running along the length),
 * W1/W2 the two end edges. Values are banding thickness in mm (0 = raw edge).
 */
export interface Banding {
  l1: number;
  l2: number;
  w1: number;
  w2: number;
}

/**
 * Outline of a shaped (non-rectangular) panel, counter-clockwise, in item-local
 * coordinates of the panel's two in-plane axes in x→y→z order (thickness z: (x, y);
 * thickness y: (x, z); thickness x: (y, z)). `box` is its bounding box.
 */
export interface PartProfile {
  points: Vec2[];
  /** Banding thickness per outline edge (edge i runs from point i to point i+1). */
  edgeBanding?: number[];
}

export interface Part {
  /** Unique in the project: `${itemId}:${key}`. */
  id: string;
  /** Stable within its item, e.g. "side-l", "door-1-0". */
  key: string;
  itemId: Id;
  itemLabel: string;
  role: PartRole;
  name: string;
  slot: MaterialSlot;
  materialId: Id;
  box: PartBox;
  thicknessAxis: Axis;
  /** Direction of the part's length (grain direction when the material has grain). */
  lengthAxis: Axis;
  /** Finished size (as assembled, including banding). */
  length: number;
  width: number;
  thickness: number;
  banding: Banding;
  /** Size to cut on the saw/CNC: finished size minus banding on the opposite edges. */
  cutLength: number;
  cutWidth: number;
  comment?: string;
  /** Doors only. */
  hinge?: HingeSide;
  /** Shaped panels only. Cut sizes are the bounding blank; the CNC cuts the outline. */
  profile?: PartProfile;
  /** Doors, drawer fronts and blind panels: stable key used for per-front overrides. */
  frontKey?: string;
  /** Doors and drawer fronts: profile for rendering and machining. */
  frontProfile?: FrontProfile;
  /** Fronts: outward direction of the visible face. */
  facing?: 'y-' | 'x+' | 'x-';
  /** J-pull fronts: which edge carries the routed pull. */
  pullEdge?: 'top' | 'bottom';
}

export interface HardwareVisual {
  kind: 'bar' | 'knob' | 'tube';
  center: Vec3;
  axis: Axis;
  length: number;
  /** Outward direction of the front the handle is on (default 'y-'). */
  facing?: 'y-' | 'x+' | 'x-';
}

export interface HardwarePlacement {
  key: string;
  itemId: Id;
  itemLabel: string;
  hardwareId: string;
  type: HardwareType;
  name: string;
  qty: number;
  /** Extra detail that makes two lines different on a schedule (e.g. runner length). */
  detail?: string;
  /** Part this hardware is fixed to. */
  partKey?: string;
  /** Hinge centre positions measured from the bottom edge of the door. */
  positions?: number[];
  visual?: HardwareVisual;
}

export interface ApplianceVolume {
  key: string;
  label: string;
  box: PartBox;
}

export interface ItemBuild {
  itemId: Id;
  parts: Part[];
  hardware: HardwarePlacement[];
  appliances: ApplianceVolume[];
  warnings: string[];
  /** True when parameters are impossible; parts is empty and `bounds` shows the requested size. */
  invalid: boolean;
  /** Local bounding box including fronts and handles' mounting plane. */
  bounds: PartBox;
}

const otherAxes = (t: Axis): [Axis, Axis] => (t === 'x' ? ['y', 'z'] : t === 'y' ? ['x', 'z'] : ['x', 'y']);
const sizeOf = (b: PartBox, a: Axis): number => (a === 'x' ? b.sx : a === 'y' ? b.sy : b.sz);

export interface PartSpec {
  key: string;
  role: PartRole;
  name: string;
  slot: MaterialSlot;
  box: PartBox;
  thicknessAxis: Axis;
  /** Preferred length axis (grain). If omitted the longer in-plane axis is used. */
  lengthAxis?: Axis;
  /** Banding per physical edge, mm. */
  edges?: Partial<Record<EdgeId, number>>;
  comment?: string;
  hinge?: HingeSide;
  profile?: PartProfile;
  frontKey?: string;
  frontProfile?: FrontProfile;
  facing?: 'y-' | 'x+' | 'x-';
  pullEdge?: 'top' | 'bottom';
  /** Overrides the slot's material (per-front overrides). */
  materialId?: Id;
}

export interface PartContext {
  itemId: Id;
  itemLabel: string;
  materialFor: (slot: MaterialSlot) => Id;
  /** Whether a material's grain direction must be respected. */
  hasGrain: (materialId: Id) => boolean;
}

export function makePart(spec: PartSpec, ctx: PartContext): Part {
  const materialId = spec.materialId ?? ctx.materialFor(spec.slot);
  const [a, b] = otherAxes(spec.thicknessAxis);
  let lengthAxis: Axis;
  if (spec.lengthAxis && ctx.hasGrain(materialId)) lengthAxis = spec.lengthAxis;
  else lengthAxis = sizeOf(spec.box, a) >= sizeOf(spec.box, b) ? a : b;
  const widthAxis: Axis = lengthAxis === a ? b : a;
  const e = spec.edges ?? {};
  const edge = (axis: Axis, end: 0 | 1): number => e[`${axis}${end}` as EdgeId] ?? 0;
  // Long edges run along the length, so they sit at the min/max of the width axis.
  // Shaped parts carry banding per outline edge; the rectangular L/W codes stay zero
  // and the cut size is the bounding blank.
  const banding: Banding = spec.profile
    ? { l1: 0, l2: 0, w1: 0, w2: 0 }
    : {
        l1: edge(widthAxis, 0),
        l2: edge(widthAxis, 1),
        w1: edge(lengthAxis, 0),
        w2: edge(lengthAxis, 1),
      };
  const length = sizeOf(spec.box, lengthAxis);
  const width = sizeOf(spec.box, widthAxis);
  return {
    id: `${ctx.itemId}:${spec.key}`,
    key: spec.key,
    itemId: ctx.itemId,
    itemLabel: ctx.itemLabel,
    role: spec.role,
    name: spec.name,
    slot: spec.slot,
    materialId,
    box: spec.box,
    thicknessAxis: spec.thicknessAxis,
    lengthAxis,
    length,
    width,
    thickness: sizeOf(spec.box, spec.thicknessAxis),
    banding,
    cutLength: length - banding.w1 - banding.w2,
    cutWidth: width - banding.l1 - banding.l2,
    comment: spec.comment,
    hinge: spec.hinge,
    profile: spec.profile,
    frontKey: spec.frontKey,
    frontProfile: spec.frontProfile,
    facing: spec.facing,
    pullEdge: spec.pullEdge,
  };
}

/** In-plane axes of a panel, in x→y→z order (the order profile points use). */
export const planeAxes = (t: Axis): [Axis, Axis] => otherAxes(t);

/** Total banded edge length of a part, mm. */
export function bandedLength(p: Part): number {
  if (p.profile) {
    const pts = p.profile.points;
    const eb = p.profile.edgeBanding ?? [];
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      if (!(eb[i] > 0)) continue;
      const q = pts[(i + 1) % pts.length];
      sum += Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    }
    return sum;
  }
  const b = p.banding;
  return (b.l1 > 0 ? p.length : 0) + (b.l2 > 0 ? p.length : 0) + (b.w1 > 0 ? p.width : 0) + (b.w2 > 0 ? p.width : 0);
}

/** Banding description for cutlists: "L1,L2,W1,W2" thicknesses, or "shaped: n edges". */
export function bandingLabel(p: Part): string {
  if (p.profile) {
    const n = (p.profile.edgeBanding ?? []).filter((b) => b > 0).length;
    return n ? `shaped: ${n} edge${n === 1 ? '' : 's'}` : 'shaped: none';
  }
  return bandingCode(p.banding);
}

export const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number): PartBox => ({ x, y, z, sx, sy, sz });

export function bandingCode(b: Banding): string {
  const f = (n: number) => (n > 0 ? String(n) : '0');
  return `${f(b.l1)},${f(b.l2)},${f(b.w1)},${f(b.w2)}`;
}

export function bandedEdgeCount(b: Banding): number {
  return [b.l1, b.l2, b.w1, b.w2].filter((n) => n > 0).length;
}
