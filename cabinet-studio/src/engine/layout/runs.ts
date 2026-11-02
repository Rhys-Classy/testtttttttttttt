// Cabinet runs and automatic benchtops/splashbacks.
//
// Every bench-height cabinet contributes one or more straight *segments* (an L-shaped
// corner cabinet contributes one per wing). Touching segments on the same back line
// form a run; each run gets one benchtop. Where a corner's return wing meets the long
// wing, the return-run top stops at the long top's front edge: a butt joint, as the
// stone or laminate is actually made.

import { overlap1D } from '../math/geometry2d';
import { angleDiff, dot, fromAngle, normalizeAngle, perpLeft, type Vec2 } from '../math/vec';
import { newId } from '../model/ids';
import type { CabinetItem, PanelItem, Room } from '../model/types';
import { hasBenchtop } from '../construction/build-cabinet';
import { allFaces, computeWalls } from '../room/walls';
import type { EndState } from './adjacency';

export interface RunSegment {
  cabinet: CabinetItem;
  rotation: number;
  /** Run frame: u along the segment, v from front to back, measured from the world origin. */
  u0: number;
  u1: number;
  vFront: number;
  vBack: number;
  top: number;
  bottom: number;
  leftExposed: boolean;
  rightExposed: boolean;
  /** When set, the top must stop exactly here at that end (corner butt joint). */
  topU0?: number;
  topU1?: number;
  /** Wing depth of the corner this end joins (splashbacks continue into the corner). */
  joinDepth?: number;
}

export interface Run {
  rotation: number;
  segments: RunSegment[];
  cabinets: CabinetItem[];
  uMin: number;
  uMax: number;
  vFront: number;
  vBack: number;
  topZ: number;
  againstWall: boolean;
  leftExposed: boolean;
  rightExposed: boolean;
  topU0?: number;
  topU1?: number;
  joinLeft?: number;
  joinRight?: number;
}

const TOL = 2;

/** Straight segments of a cabinet in run coordinates. `trim` = front thickness + front overhang. */
export function segmentsOf(c: CabinetItem, ends: EndState | undefined, trim: number): RunSegment[] {
  const p = c.params;
  const X = fromAngle(c.placement.rotation);
  const Y = perpLeft(X);
  const o: Vec2 = { x: c.placement.x, y: c.placement.y };
  const ox = dot(o, X);
  const oy = dot(o, Y);
  const top = c.placement.elevation + p.height;
  const bottom = c.placement.elevation;
  const L = ends?.left ?? true;
  const Rt = ends?.right ?? true;
  const corner = p.corner;
  if (!corner) {
    return [{ cabinet: c, rotation: c.placement.rotation, u0: ox, u1: ox + p.width, vFront: oy, vBack: oy + p.depth, top, bottom, leftExposed: L, rightExposed: Rt }];
  }
  const W = p.width;
  const R = corner.returnWidth;
  const D = p.depth;
  const segA: RunSegment = {
    cabinet: c,
    rotation: c.placement.rotation,
    u0: ox,
    u1: ox + W,
    vFront: oy + R - D,
    vBack: oy + R,
    top,
    bottom,
    leftExposed: corner.side === 'left' ? false : L,
    rightExposed: corner.side === 'left' ? Rt : false,
  };
  if (corner.side === 'left') {
    // Return wing along the left wall: frame rotated +90°, u along local +y, v along local −x.
    const rot = normalizeAngle(c.placement.rotation + Math.PI / 2);
    const segB: RunSegment = {
      cabinet: c,
      rotation: rot,
      u0: oy,
      u1: oy + (R - D),
      vFront: -ox - D,
      vBack: -ox,
      top,
      bottom,
      leftExposed: L,
      rightExposed: false,
      topU1: oy + R - D - trim,
      joinDepth: D,
    };
    return [segA, segB];
  }
  // Right-hand corner: return wing along the right wall, frame rotated −90°.
  const rot = normalizeAngle(c.placement.rotation - Math.PI / 2);
  const segB: RunSegment = {
    cabinet: c,
    rotation: rot,
    u0: -oy - (R - D),
    u1: -oy,
    vFront: ox + W - D,
    vBack: ox + W,
    top,
    bottom,
    leftExposed: false,
    rightExposed: Rt,
    topU0: -oy - (R - D) + trim,
    joinDepth: D,
  };
  return [segA, segB];
}

export function computeBenchRuns(room: Room, ends: Map<string, EndState>, trim = 40): Run[] {
  const segs = room.items
    .filter((i): i is CabinetItem => i.kind === 'cabinet' && hasBenchtop(i.category))
    .flatMap((c) => segmentsOf(c, ends.get(c.id), trim));
  const faces = allFaces(computeWalls(room.walls));
  const used = new Set<RunSegment>();
  const runs: Run[] = [];
  for (const seed of segs) {
    if (used.has(seed)) continue;
    const members = [seed];
    used.add(seed);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of segs) {
        if (used.has(s) || angleDiff(s.rotation, seed.rotation) > 0.01) continue;
        if (Math.abs(s.vBack - seed.vBack) > TOL || Math.abs(s.top - seed.top) > TOL) continue;
        const touches = members.some((m) => Math.abs(m.u1 - s.u0) <= TOL || Math.abs(s.u1 - m.u0) <= TOL || overlap1D(m.u0, m.u1, s.u0, s.u1) > 0);
        if (touches) {
          members.push(s);
          used.add(s);
          grew = true;
        }
      }
    }
    members.sort((a, b) => a.u0 - b.u0);
    const first = members[0];
    const last = members.reduce((a, b) => (b.u1 > a.u1 ? b : a));
    const X = fromAngle(seed.rotation);
    const Y = perpLeft(X);
    const uMin = first.u0;
    const uMax = last.u1;
    // Against a wall when a wall face lies on the back line and covers the run.
    const againstWall = faces.some((f) => {
      const n = f.normal;
      if (Math.abs(n.x + Y.x) > 0.01 || Math.abs(n.y + Y.y) > 0.01) return false;
      if (Math.abs(dot(f.a, Y) - seed.vBack) > 3) return false;
      const fu = [dot(f.a, X), dot(f.b, X)];
      return overlap1D(Math.min(...fu), Math.max(...fu), uMin, uMax) > (uMax - uMin) * 0.5;
    });
    runs.push({
      rotation: seed.rotation,
      segments: members,
      cabinets: [...new Set(members.map((m) => m.cabinet))],
      uMin,
      uMax,
      vFront: Math.min(...members.map((m) => m.vFront)),
      vBack: seed.vBack,
      topZ: seed.top,
      againstWall,
      leftExposed: first.leftExposed,
      rightExposed: last.rightExposed,
      topU0: first.topU0,
      topU1: last.topU1,
      joinLeft: first.topU0 != null ? first.joinDepth : undefined,
      joinRight: last.topU1 != null ? last.joinDepth : undefined,
    });
  }
  return runs;
}

export interface AutoTopSettings {
  thickness: number;
  /** Overhang past the face of the fronts. */
  frontOverhang: number;
  /** Overhang past exposed ends. */
  endOverhang: number;
  frontThickness: number;
  splashbacks: boolean;
  splashThickness: number;
  /** Splashback height when no wall cabinets are above the run. */
  splashHeight: number;
}

export const DEFAULT_AUTO_TOPS: AutoTopSettings = {
  thickness: 20,
  frontOverhang: 22,
  endOverhang: 20,
  frontThickness: 18,
  splashbacks: true,
  splashThickness: 6,
  splashHeight: 600,
};

/** Generate benchtops (and splashbacks against walls) for every run of bench-height cabinets. */
export function autoTops(room: Room, ends: Map<string, EndState>, s: AutoTopSettings, nextLabel: (prefix: string) => string): PanelItem[] {
  const out: PanelItem[] = [];
  const trim = s.frontThickness + s.frontOverhang;
  const above = room.items.filter((i): i is CabinetItem => i.kind === 'cabinet').flatMap((c) => segmentsOf(c, ends.get(c.id), trim));
  for (const run of computeBenchRuns(room, ends, trim)) {
    const X = fromAngle(run.rotation);
    const Y = perpLeft(X);
    const u0 = run.topU0 ?? run.uMin - (run.leftExposed ? s.endOverhang : 0);
    const u1 = run.topU1 ?? run.uMax + (run.rightExposed ? s.endOverhang : 0);
    const vF = run.vFront - trim;
    if (u1 - u0 < 50) continue;
    const at = (u: number, v: number) => ({ x: X.x * u + Y.x * v, y: X.y * u + Y.y * v });
    const o = at(u0, vF);
    out.push({
      kind: 'panel',
      id: newId('pnl'),
      label: nextLabel('BT'),
      name: 'Benchtop',
      panelType: 'benchtop',
      width: u1 - u0,
      depth: run.vBack - vF,
      height: s.thickness,
      materialSlot: 'benchtop',
      materialId: null,
      placement: { x: o.x, y: o.y, rotation: run.rotation, elevation: run.topZ },
      wallId: run.cabinets[0].wallId ?? null,
      auto: true,
    });
    if (!s.splashbacks || !run.againstWall) continue;
    const base = run.topZ + s.thickness;
    // Stop under any wall cabinets on the same back line above this run.
    let topZ = base + s.splashHeight;
    for (const seg of above) {
      if (seg.bottom < base + 100 || angleDiff(seg.rotation, run.rotation) > 0.01) continue;
      if (Math.abs(seg.vBack - run.vBack) > TOL) continue;
      if (overlap1D(seg.u0, seg.u1, run.uMin, run.uMax) <= 0) continue;
      topZ = Math.min(topZ, seg.bottom);
    }
    // Into a corner, the splashback runs on to meet the long wall's splashback.
    const su0 = run.joinLeft != null ? run.uMin - run.joinLeft + s.splashThickness : Math.max(u0, run.uMin);
    const su1 = run.joinRight != null ? run.uMax + run.joinRight - s.splashThickness : Math.min(u1, run.uMax);
    const so = at(su0, run.vBack - s.splashThickness);
    out.push({
      kind: 'panel',
      id: newId('pnl'),
      label: nextLabel('SB'),
      name: 'Splashback',
      panelType: 'splashback',
      width: su1 - su0,
      depth: s.splashThickness,
      height: Math.max(50, topZ - base),
      materialSlot: 'splashback',
      materialId: null,
      placement: { x: so.x, y: so.y, rotation: run.rotation, elevation: base },
      wallId: run.cabinets[0].wallId ?? null,
      auto: true,
    });
  }
  return out;
}
