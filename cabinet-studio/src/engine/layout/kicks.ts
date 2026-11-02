// Continuous kickboards per run. Cabinets in a run drop their own kick (params.kickboard =
// false) and the run gets one auto 'kick' panel, split at maxLength, with end returns.

import { angleDiff, fromAngle, normalizeAngle, perpLeft } from '../math/vec';
import { newId } from '../model/ids';
import type { CabinetItem, ConstructionRules, PanelItem, Room } from '../model/types';
import type { EndState } from './adjacency';
import { segmentsOf, type RunSegment } from './runs';

export interface AutoKickSettings {
  returns: boolean;
  maxLength: number;
}

export const DEFAULT_AUTO_KICKS: AutoKickSettings = { returns: true, maxLength: 3600 };

export interface AutoKickResult {
  panels: PanelItem[];
  /** Cabinets whose own kickboard is replaced (the caller sets kickboard: false). */
  cabinetIds: string[];
}

const TOL = 2;

interface KickSeg {
  seg: RunSegment;
  k0: number;
  k1: number;
  vK: number;
  h: number;
}

export function autoKicks(
  room: Room,
  ends: Map<string, EndState>,
  rules: Pick<ConstructionRules, 'kickSetback' | 'kickThickness' | 'kickTopGap'>,
  s: AutoKickSettings,
  nextLabel: (prefix: string) => string,
): AutoKickResult {
  const ks = rules.kickSetback;
  const kt = rules.kickThickness;
  const segs: KickSeg[] = [];
  const ids = new Set<string>();
  for (const c of room.items) {
    if (c.kind !== 'cabinet' || c.placement.elevation >= 1 || !(c.params.kickHeight > 0)) continue;
    const D = c.params.depth;
    const side = c.params.corner?.side;
    const h = c.params.kickHeight - rules.kickTopGap;
    segmentsOf(c, ends.get(c.id), 0).forEach((seg, i) => {
      let k0 = seg.u0;
      let k1 = seg.u1;
      if (side === 'left') (i === 0 ? (k0 += D - ks - kt) : (k1 += ks));
      else if (side === 'right') (i === 0 ? (k1 -= D - ks - kt) : (k0 -= ks));
      segs.push({ seg, k0, k1, vK: seg.vFront + ks, h });
      ids.add(c.id);
    });
  }
  const out: PanelItem[] = [];
  const used = new Set<KickSeg>();
  for (const seed of segs) {
    if (used.has(seed)) continue;
    const members = [seed];
    used.add(seed);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of segs) {
        if (used.has(m) || angleDiff(m.seg.rotation, seed.seg.rotation) > 0.01) continue;
        if (Math.abs(m.vK - seed.vK) > TOL || Math.abs(m.h - seed.h) > 1) continue;
        if (members.some((o) => m.k0 <= o.k1 + TOL && o.k0 <= m.k1 + TOL)) {
          members.push(m);
          used.add(m);
          grew = true;
        }
      }
    }
    const first = members.reduce((a, b) => (b.k0 < a.k0 ? b : a));
    const last = members.reduce((a, b) => (b.k1 > a.k1 ? b : a));
    const rot = seed.seg.rotation;
    const X = fromAngle(rot);
    const Y = perpLeft(X);
    const at = (u: number, v: number) => ({ x: X.x * u + Y.x * v, y: X.y * u + Y.y * v });
    const { vK, h } = seed;
    const wallId = (members[0].seg.cabinet as CabinetItem).wallId ?? null;
    const mk = (name: string, u: number, v: number, r: number, width: number): PanelItem => {
      const o = at(u, v);
      return {
        kind: 'panel',
        id: newId('pnl'),
        label: nextLabel('K'),
        name,
        panelType: 'kick',
        width,
        depth: kt,
        height: h,
        materialSlot: 'kick',
        materialId: null,
        placement: { x: o.x, y: o.y, rotation: r, elevation: 0 },
        wallId,
        auto: true,
      };
    };
    let a = first.k0;
    let b = last.k1;
    if (s.returns && first.seg.leftExposed) {
      a += ks;
      // The return's thickness runs toward −u from its origin: origin at a + kt puts it
      // behind the front kick's end ([a, a + kt]) so the outside corner closes flush.
      out.push(mk('Kickboard return', a + kt, vK + kt, normalizeAngle(rot + Math.PI / 2), first.seg.vBack - vK - kt));
    }
    if (s.returns && last.seg.rightExposed) {
      b -= ks;
      out.push(mk('Kickboard return', b, vK + kt, normalizeAngle(rot + Math.PI / 2), last.seg.vBack - vK - kt));
    }
    if (b - a < 1) continue;
    const n = Math.max(1, Math.ceil((b - a) / s.maxLength - 1e-9));
    const len = (b - a) / n;
    for (let i = 0; i < n; i++) out.push(mk('Kickboard', a + i * len, vK, rot, len));
  }
  return { panels: out, cabinetIds: [...ids] };
}
