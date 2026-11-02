// Doors and drawer fronts: per-front overrides (trim, hinge, handle, profile, material),
// manufacturing notes for front profiles, and handle placement for any facing direction.

import { HANDLE_LENGTHS } from '../library/hardware';
import { clamp } from '../math/vec';
import type { CabinetItem, FrontProfile, HandleStyle, HingeSide, Id } from '../model/types';
import type { HardwareVisual, PartBox } from './parts';

/** Which way a front faces (outward normal). Normal cabinets face −y. */
export type Facing = 'y-' | 'x+' | 'x-';

export interface FrontPlan {
  frontKey: string;
  box: PartBox;
  hinge?: HingeSide;
  handle: HandleStyle;
  profile: FrontProfile;
  materialId?: Id;
  comment?: string;
  pullEdge: 'top' | 'bottom';
}

export function profileComment(p: FrontProfile, pullEdge: 'top' | 'bottom'): string | undefined {
  switch (p) {
    case 'shaker':
      return 'Shaker: 70 mm frame, 6 mm CNC pocket';
    case 'v-groove':
      return 'V-groove: 3 mm grooves at 80 mm centres';
    case 'j-pull':
      return `J-pull handle routed on ${pullEdge} edge`;
    default:
      return undefined;
  }
}

/**
 * Apply a cabinet's per-front override to a generated front. Trims are relative to the
 * viewer standing in front of that face (left/right as they see it).
 */
export function planFront(cab: CabinetItem, frontKey: string, base: PartBox, facing: Facing, hinge: HingeSide | undefined, pullEdge: 'top' | 'bottom'): FrontPlan {
  const o = cab.frontOverrides?.[frontKey];
  const b = { ...base };
  const t = o?.trim;
  if (t) {
    const l = t.left ?? 0;
    const r = t.right ?? 0;
    const top = t.top ?? 0;
    const bot = t.bottom ?? 0;
    b.z -= bot;
    b.sz += bot + top;
    if (facing === 'y-') {
      b.x -= l;
      b.sx += l + r;
    } else if (facing === 'x+') {
      b.y -= l;
      b.sy += l + r;
    } else {
      b.y -= r;
      b.sy += l + r;
    }
  }
  const profile = o?.profile ?? cab.params.profile ?? 'slab';
  return {
    frontKey,
    box: b,
    hinge: o?.hinge ?? hinge,
    handle: profile === 'j-pull' ? 'none' : (o?.handle ?? cab.params.handle),
    profile,
    materialId: o?.materialId,
    comment: profileComment(profile, pullEdge),
    pullEdge,
  };
}

/** Width axis of a front (horizontal, in its own plane). */
const widthAxis = (f: Facing) => (f === 'y-' ? 'x' : 'y');

/**
 * Handle position for a front. Doors: vertical bar on the side away from the hinge,
 * at `zRule` ('top' near the top, 'bottom' near the bottom, or an absolute local height).
 * Drawers: horizontal bar centred, near the top on deep fronts.
 */
export function handleVisual(style: HandleStyle, pb: PartBox, facing: Facing, kind: 'door' | 'drawer', hinge: HingeSide | undefined, zRule: 'top' | 'bottom' | number): HardwareVisual | null {
  if (style === 'none') return null;
  const len = HANDLE_LENGTHS[style] ?? 160;
  const wAxis = widthAxis(facing);
  const w0 = wAxis === 'x' ? pb.x : pb.y;
  const ws = wAxis === 'x' ? pb.sx : pb.sy;
  // Viewer's right runs along +x for y− facing, +y for x+ facing, −y for x− facing.
  const rightIsMax = facing !== 'x-';
  let along: number;
  let cz: number;
  let axis: HardwareVisual['axis'];
  if (kind === 'drawer') {
    axis = wAxis;
    along = w0 + ws / 2;
    cz = pb.sz < 220 ? pb.z + pb.sz / 2 : pb.z + pb.sz - 50;
  } else {
    axis = 'z';
    const handleOnRight = hinge === 'left';
    const atMax = handleOnRight === rightIsMax;
    along = atMax ? w0 + ws - 40 : w0 + 40;
    const half = len / 2 + 40;
    const zMin = pb.z + half;
    const zMax = pb.z + pb.sz - half;
    const target = zRule === 'top' ? zMax : zRule === 'bottom' ? zMin : zRule;
    cz = zMax < zMin ? pb.z + pb.sz / 2 : clamp(target, zMin, zMax);
  }
  const center =
    facing === 'y-'
      ? { x: along, y: pb.y - 14, z: cz }
      : facing === 'x+'
        ? { x: pb.x + pb.sx + 14, y: along, z: cz }
        : { x: pb.x - 14, y: along, z: cz };
  return { kind: style === 'knob' ? 'knob' : 'bar', center, axis, length: len, facing };
}

export const handleHardwareId = (style: HandleStyle) => (style === 'knob' ? 'handle-knob' : `handle-${style}`);
