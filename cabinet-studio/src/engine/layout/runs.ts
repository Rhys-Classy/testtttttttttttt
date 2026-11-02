// Cabinet runs and automatic benchtops/splashbacks.

import { overlap1D } from '../math/geometry2d';
import { angleDiff, dot, fromAngle, perpLeft, type Vec2 } from '../math/vec';
import { newId } from '../model/ids';
import type { CabinetItem, PanelItem, Room } from '../model/types';
import { hasBenchtop } from '../construction/build-cabinet';
import type { EndState } from './adjacency';

export interface Run {
  rotation: number;
  cabinets: CabinetItem[];
  /** Run frame: u along the cabinets' x axis, v along their y axis (front → back), from the world origin. */
  uMin: number;
  uMax: number;
  /** v of the carcass fronts and backs. */
  vFront: number;
  vBack: number;
  topZ: number;
  againstWall: boolean;
  leftExposed: boolean;
  rightExposed: boolean;
}

const TOL = 2;

export function computeBenchRuns(room: Room, ends: Map<string, EndState>): Run[] {
  const cabs = room.items.filter((i): i is CabinetItem => i.kind === 'cabinet' && hasBenchtop(i.category));
  const used = new Set<string>();
  const runs: Run[] = [];
  const frameVals = (c: CabinetItem) => {
    const xAxis = fromAngle(c.placement.rotation);
    const yAxis = perpLeft(xAxis);
    const o: Vec2 = { x: c.placement.x, y: c.placement.y };
    const u0 = dot(o, xAxis);
    const v0 = dot(o, yAxis);
    return { u0, u1: u0 + c.params.width, vF: v0, vB: v0 + c.params.depth, top: c.placement.elevation + c.params.height, xAxis, yAxis };
  };
  for (const seed of cabs) {
    if (used.has(seed.id)) continue;
    const members = [seed];
    used.add(seed.id);
    const sv = frameVals(seed);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of cabs) {
        if (used.has(c.id) || angleDiff(c.placement.rotation, seed.placement.rotation) > 0.01) continue;
        const xAxis = sv.xAxis;
        const yAxis = sv.yAxis;
        const o = { x: c.placement.x, y: c.placement.y };
        const cu0 = dot(o, xAxis);
        const cu1 = cu0 + c.params.width;
        const cvB = dot(o, yAxis) + c.params.depth;
        const ctop = c.placement.elevation + c.params.height;
        if (Math.abs(cvB - sv.vB) > TOL || Math.abs(ctop - sv.top) > TOL) continue;
        const touches = members.some((m) => {
          const mv = frameVals(m);
          return Math.abs(mv.u1 - cu0) <= TOL || Math.abs(cu1 - mv.u0) <= TOL || overlap1D(mv.u0, mv.u1, cu0, cu1) > 0;
        });
        if (touches) {
          members.push(c);
          used.add(c.id);
          grew = true;
        }
      }
    }
    const vals = members.map(frameVals);
    const uMin = Math.min(...vals.map((v) => v.u0));
    const uMax = Math.max(...vals.map((v) => v.u1));
    const leftMost = members[vals.findIndex((v) => v.u0 === uMin)];
    const rightMost = members[vals.findIndex((v) => v.u1 === uMax)];
    runs.push({
      rotation: seed.placement.rotation,
      cabinets: members.sort((a, b) => frameVals(a).u0 - frameVals(b).u0),
      uMin,
      uMax,
      vFront: Math.min(...vals.map((v) => v.vF)),
      vBack: sv.vB,
      topZ: sv.top,
      againstWall: members.some((m) => !!m.wallId),
      leftExposed: ends.get(leftMost.id)?.left ?? true,
      rightExposed: ends.get(rightMost.id)?.right ?? true,
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
  for (const run of computeBenchRuns(room, ends)) {
    const xAxis = fromAngle(run.rotation);
    const yAxis = perpLeft(xAxis);
    const u0 = run.uMin - (run.leftExposed ? s.endOverhang : 0);
    const u1 = run.uMax + (run.rightExposed ? s.endOverhang : 0);
    const vF = run.vFront - s.frontThickness - s.frontOverhang;
    const at = (u: number, v: number) => ({ x: xAxis.x * u + yAxis.x * v, y: xAxis.y * u + yAxis.y * v });
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
    let top = base + s.splashHeight;
    for (const it of room.items) {
      if (it.kind !== 'cabinet' || angleDiff(it.placement.rotation, run.rotation) > 0.01) continue;
      if (it.placement.elevation < base + 100) continue;
      const iu0 = dot({ x: it.placement.x, y: it.placement.y }, xAxis);
      const ivB = dot({ x: it.placement.x, y: it.placement.y }, yAxis) + it.params.depth;
      if (Math.abs(ivB - run.vBack) > TOL) continue;
      if (overlap1D(iu0, iu0 + it.params.width, run.uMin, run.uMax) <= 0) continue;
      top = Math.min(top, it.placement.elevation);
    }
    const so = at(run.uMin, run.vBack - s.splashThickness);
    out.push({
      kind: 'panel',
      id: newId('pnl'),
      label: nextLabel('SB'),
      name: 'Splashback',
      panelType: 'splashback',
      width: run.uMax - run.uMin,
      depth: s.splashThickness,
      height: Math.max(50, top - base),
      materialSlot: 'splashback',
      materialId: null,
      placement: { x: so.x, y: so.y, rotation: run.rotation, elevation: base },
      wallId: run.cabinets[0].wallId ?? null,
      auto: true,
    });
  }
  return out;
}
