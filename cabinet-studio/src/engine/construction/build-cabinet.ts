// Parametric cabinet construction: CabinetItem + ConstructionRules → manufacturing parts.
//
// This function is pure and deterministic. Changing any parameter (width, height,
// depth, kick, fronts, rules) and calling it again regenerates every part — sides, top,
// bottom, back, shelves, doors, drawer fronts and drawer boxes — from the rules, so the
// 3D model, drawings and cutlist can never disagree.

import { HARDWARE } from '../library/hardware';
import { handleHardwareId, handleVisual, planFront } from './fronts';
import { buildCornerCabinet } from './build-corner';
import { clamp, clean } from '../math/vec';
import type { CabinetCategory, CabinetItem, ConstructionRules, FrontSection, HandleStyle, Id, MaterialDef, MaterialSlot } from '../model/types';
import {
  box,
  makePart,
  type ApplianceVolume,
  type Axis,
  type EdgeId,
  type HardwarePlacement,
  type ItemBuild,
  type Part,
  type PartBox,
  type PartContext,
  type PartSpec,
} from './parts';

export interface BuildContext {
  rules: ConstructionRules;
  materialFor: (slot: MaterialSlot) => Id;
  materials: ReadonlyMap<Id, MaterialDef>;
  /** Resolved finished/unfinished state of each end (see layout/adjacency). */
  finishedEnds: { left: boolean; right: boolean };
}

const BENCH_CATEGORIES: CabinetCategory[] = ['base', 'laundry', 'vanity'];

/** Cabinets that normally carry a benchtop (base-style construction with rails). */
export const hasBenchtop = (c: CabinetCategory): boolean => BENCH_CATEGORIES.includes(c);

const fmt = (n: number): string => String(Math.round(n * 10) / 10);

export function validateCabinet(cab: CabinetItem, r: ConstructionRules): string[] {
  const p = cab.params;
  const t = r.carcassThickness;
  const out: string[] = [];
  const nums: [string, number][] = [
    ['Width', p.width],
    ['Height', p.height],
    ['Depth', p.depth],
    ['Kick height', p.kickHeight],
  ];
  for (const [name, v] of nums) if (!Number.isFinite(v)) out.push(`${name} must be a number.`);
  if (out.length) return out;
  if (p.width < 2 * t + 40) out.push(`Width must be at least ${2 * t + 40} mm for ${t} mm sides.`);
  if (p.kickHeight < 0) out.push('Kick height cannot be negative.');
  if (p.height - p.kickHeight < 2 * t + 40)
    out.push(`Height must be at least ${p.kickHeight + 2 * t + 40} mm (carcass above a ${p.kickHeight} mm kick).`);
  const minDepth = r.backThickness + (r.backMethod === 'groove' ? r.backSetback : 0) + 60;
  if (p.depth < minDepth) out.push(`Depth must be at least ${minDepth} mm with this back construction.`);
  if (p.blind && (p.blind.width < 100 || p.blind.width > p.width - 150))
    out.push(`Blind width must be between 100 and ${Math.max(100, p.width - 150)} mm.`);
  for (const s of p.fronts) {
    if (s.height != null && !(s.height > 0)) out.push('Front heights must be greater than zero.');
  }
  return out;
}

export function hingeCount(r: ConstructionRules, doorHeight: number): number {
  const rules = [...r.hingeRules].sort((a, b) => a.maxDoorHeight - b.maxDoorHeight);
  for (const rule of rules) if (doorHeight <= rule.maxDoorHeight) return rule.count;
  return rules.length ? rules[rules.length - 1].count + 1 : 2;
}

/** Hinge centres measured from the bottom edge of the door, evenly spread between the end offsets. */
export function hingePositions(doorHeight: number, count: number, edgeOffset: number): number[] {
  const off = Math.min(edgeOffset, doorHeight / 4);
  if (count <= 1) return [clean(doorHeight / 2)];
  const span = doorHeight - 2 * off;
  return Array.from({ length: count }, (_, i) => clean(off + (span * i) / (count - 1)));
}

/** Number of fasteners along a joint of the given length. */
export function fastenersForJoint(r: ConstructionRules, jointLength: number): number {
  const usable = Math.max(0, jointLength - 2 * r.fastenerEdgeDistance);
  return Math.max(2, Math.ceil(usable / r.fastenerSpacing) + 1);
}

const allEdges = (thicknessAxis: Axis, band: number): Partial<Record<EdgeId, number>> => {
  const axes = (['x', 'y', 'z'] as Axis[]).filter((a) => a !== thicknessAxis);
  const e: Partial<Record<EdgeId, number>> = {};
  for (const a of axes) {
    e[`${a}0` as EdgeId] = band;
    e[`${a}1` as EdgeId] = band;
  }
  return e;
};

interface SectionLayout {
  s: FrontSection;
  i: number;
  zTop: number;
  zBot: number;
  h: number;
}

export function buildCabinet(cab: CabinetItem, ctx: BuildContext): ItemBuild {
  const r = ctx.rules;
  const p = cab.params;
  const W = p.width;
  const H = p.height;
  const D = p.depth;
  const t = r.carcassThickness;
  const tb = r.backThickness;
  const k = Math.max(0, p.kickHeight);
  const ft = r.frontThickness;
  const gap = r.frontGap;
  const overlay = r.frontStyle === 'overlay';
  const benchCab = hasBenchtop(cab.category);
  const bounds = box(0, overlay ? -ft : 0, 0, W, overlay ? D + ft : D, H);
  const warnings: string[] = [];

  if (p.corner) return buildCornerCabinet(cab, ctx);
  const problems = validateCabinet(cab, r);
  if (problems.length) {
    return { itemId: cab.id, parts: [], hardware: [], appliances: [], warnings: problems, invalid: true, bounds };
  }

  const parts: Part[] = [];
  const hardware: HardwarePlacement[] = [];
  const appliances: ApplianceVolume[] = [];
  const pctx: PartContext = {
    itemId: cab.id,
    itemLabel: cab.label,
    materialFor: ctx.materialFor,
    hasGrain: (id) => ctx.materials.get(id)?.grain ?? false,
  };
  const add = (spec: PartSpec): Part => {
    const part = makePart(spec, pctx);
    parts.push(part);
    return part;
  };
  const addHw = (hw: Omit<HardwarePlacement, 'itemId' | 'itemLabel' | 'name' | 'type'>): void => {
    const def = HARDWARE[hw.hardwareId];
    if (!def) {
      warnings.push(`Unknown hardware "${hw.hardwareId}".`);
      return;
    }
    hardware.push({ ...hw, itemId: cab.id, itemLabel: cab.label, name: def.name, type: def.type });
  };

  const cb = r.carcassBanding;
  const fb = r.frontBanding;
  const hd = Math.max(0, r.housingDepth);
  const topFull = !(benchCab && r.baseTopType === 'rails');
  const between = (j: string) => j === 'between-sides';

  // ── Back geometry drives the depth of everything else ──
  const sideDepth = r.backMethod === 'applied' ? D - tb : D;
  const horizDepth = r.backMethod === 'groove' ? D : D - tb;
  const interiorBack = r.backMethod === 'groove' ? D - r.backSetback - tb : D - tb;

  // ── Sides ──
  const sideZ0 = k + (r.bottomJoint === 'full-width' ? t : 0);
  const sideZ1 = H - (topFull && r.topJoint === 'full-width' ? t : 0);
  for (const side of ['left', 'right'] as const) {
    const finished = side === 'left' ? ctx.finishedEnds.left : ctx.finishedEnds.right;
    const tag = side === 'left' ? 'L' : 'R';
    add({
      key: `side-${side === 'left' ? 'l' : 'r'}`,
      role: 'side',
      name: finished ? `Finished End (${tag})` : `End (${tag})`,
      slot: finished ? 'front' : 'carcass',
      box: box(side === 'left' ? 0 : W - t, 0, sideZ0, t, sideDepth, sideZ1 - sideZ0),
      thicknessAxis: 'x',
      lengthAxis: 'z',
      edges: finished ? { y0: fb, z0: fb, z1: fb } : { y0: cb },
      comment: finished ? 'Visible end — matches fronts' : undefined,
    });
  }

  // ── Bottom ──
  const housedNote = (j: string) => (hd > 0 && between(j) ? `Housed ${fmt(hd)} mm into sides` : undefined);
  add({
    key: 'bottom',
    role: 'bottom',
    name: 'Bottom',
    slot: 'carcass',
    box: between(r.bottomJoint) ? box(t - hd, 0, k, W - 2 * t + 2 * hd, horizDepth, t) : box(0, 0, k, W, horizDepth, t),
    thicknessAxis: 'z',
    lengthAxis: 'x',
    edges: { y0: cb },
    comment: housedNote(r.bottomJoint),
  });

  // ── Top or rails ──
  const railW = Math.min(r.railWidth, interiorBack / 2);
  if (topFull) {
    add({
      key: 'top',
      role: 'top',
      name: 'Top',
      slot: 'carcass',
      box: between(r.topJoint) ? box(t - hd, 0, H - t, W - 2 * t + 2 * hd, horizDepth, t) : box(0, 0, H - t, W, horizDepth, t),
      thicknessAxis: 'z',
      lengthAxis: 'x',
      edges: { y0: cb },
      comment: housedNote(r.topJoint),
    });
  } else {
    add({
      key: 'rail-front',
      role: 'rail',
      name: 'Front Rail',
      slot: 'carcass',
      box: box(t, 0, H - t, W - 2 * t, railW, t),
      thicknessAxis: 'z',
      lengthAxis: 'x',
      edges: { y0: cb },
    });
    add({
      key: 'rail-back',
      role: 'rail',
      name: 'Back Rail',
      slot: 'carcass',
      box: box(t, interiorBack - railW, H - t, W - 2 * t, railW, t),
      thicknessAxis: 'z',
      lengthAxis: 'x',
    });
  }

  // ── Back ──
  if (r.backMethod === 'inset') {
    add({
      key: 'back',
      role: 'back',
      name: 'Back',
      slot: 'back',
      box: box(t, D - tb, sideZ0, W - 2 * t, tb, sideZ1 - sideZ0),
      thicknessAxis: 'y',
      lengthAxis: 'z',
      comment: 'Fixed between sides',
    });
  } else if (r.backMethod === 'groove') {
    const g = r.backGrooveDepth;
    const z0 = k + t - g;
    const z1 = topFull ? H - t + g : H;
    add({
      key: 'back',
      role: 'back',
      name: 'Back',
      slot: 'back',
      box: box(t - g, D - r.backSetback - tb, z0, W - 2 * t + 2 * g, tb, z1 - z0),
      thicknessAxis: 'y',
      lengthAxis: 'z',
      comment: `In ${fmt(g)} mm groove, ${fmt(r.backSetback)} mm from rear`,
    });
  } else {
    add({
      key: 'back',
      role: 'back',
      name: 'Back',
      slot: 'back',
      box: box(0, D - tb, k, W, tb, H - k),
      thicknessAxis: 'y',
      lengthAxis: 'z',
      comment: 'Applied to rear',
    });
  }

  // ── Interior and front zone ──
  const ix0 = t;
  const ix1 = W - t;
  const iz0 = k + t;
  const iz1 = H - t;
  const iy0 = overlay ? 0 : ft;
  const iy1 = interiorBack;
  const Wi = ix1 - ix0;
  const Di = iy1 - iy0;

  let fx0: number;
  let fx1: number;
  let fz0: number;
  let fz1: number;
  const fy0 = overlay ? -ft : 0;
  if (overlay) {
    fx0 = r.frontRevealSide;
    fx1 = W - r.frontRevealSide;
    fz0 = k + r.frontRevealBottom - (cab.category === 'wall' ? r.wallFrontOverhangBottom : 0);
    fz1 = H - r.frontRevealTop;
  } else {
    fx0 = ix0 + gap;
    fx1 = ix1 - gap;
    fz0 = iz0 + gap;
    fz1 = iz1 - gap;
  }

  if (p.blind && p.blind.width > 0) {
    const bw = p.blind.width;
    const bx0 = p.blind.side === 'left' ? fx0 : W - bw + gap / 2;
    const bx1 = p.blind.side === 'left' ? bw - gap / 2 : fx1;
    if (p.blind.side === 'left') fx0 = bw + gap / 2;
    else fx1 = W - bw - gap / 2;
    add({
      key: 'blind',
      role: 'blind-panel',
      name: 'Blind Panel',
      slot: 'front',
      box: box(bx0, fy0, fz0, bx1 - bx0, ft, fz1 - fz0),
      thicknessAxis: 'y',
      lengthAxis: 'z',
      edges: allEdges('y', fb),
      comment: `Fixed — ${p.blind.side} blind corner`,
      frontKey: 'blind',
      facing: 'y-',
      materialId: cab.frontOverrides?.blind?.materialId,
    });
  }

  // ── Vertical layout of fronts (top to bottom) ──
  const sections: FrontSection[] = p.fronts.length ? p.fronts : [{ id: 'open', kind: 'open', height: null, shelves: 0 }];
  const n = sections.length;
  const zoneW = fx1 - fx0;
  const avail = fz1 - fz0 - gap * (n - 1);
  const heights: (number | null)[] = sections.map((s) => s.height);
  if (!heights.some((h) => h == null)) {
    const last = n - 1;
    const others = heights.slice(0, last).reduce<number>((a, h) => a + (h ?? 0), 0);
    const lastH = avail - others;
    if (Math.abs(lastH - (heights[last] ?? 0)) > 0.5) {
      warnings.push(`Front heights don't add up to the cabinet; the bottom front was sized to ${fmt(lastH)} mm.`);
    }
    heights[last] = null;
  }
  const autoCount = heights.filter((h) => h == null).length;
  let fixedSum = heights.reduce<number>((a, h) => a + (h ?? 0), 0);
  let autoH = (avail - fixedSum) / autoCount;
  if (autoH < r.minFrontHeight) {
    const room = avail - autoCount * r.minFrontHeight;
    if (room <= 0 || fixedSum <= 0) {
      return {
        itemId: cab.id,
        parts: [],
        hardware: [],
        appliances: [],
        warnings: [`${n} fronts don't fit in ${fmt(avail + gap * (n - 1))} mm of front height. Remove a front or make the cabinet taller.`],
        invalid: true,
        bounds,
      };
    }
    const factor = room / fixedSum;
    warnings.push(`Fixed front heights (${fmt(fixedSum)} mm) leave no room for the other fronts; they were scaled to fit.`);
    for (let i = 0; i < n; i++) if (heights[i] != null) heights[i] = (heights[i] as number) * factor;
    fixedSum = room;
    autoH = r.minFrontHeight;
  }
  let zCursor = fz1;
  const layout: SectionLayout[] = sections.map((s, i) => {
    const h = heights[i] ?? autoH;
    const L = { s, i, zTop: zCursor, zBot: zCursor - h, h };
    zCursor -= h + gap;
    return L;
  });

  const bandTop = (i: number) => (i === 0 ? iz1 : clamp(layout[i].zTop + gap / 2, iz0, iz1));
  const bandBot = (i: number) => (i === n - 1 ? iz0 : clamp(layout[i].zBot - gap / 2, iz0, iz1));

  // Fixed shelves either side of appliance openings.
  let fixedShelfCount = 0;
  const shelfBelow: (number | null)[] = Array(n).fill(null); // top face z of shelf under section i
  const shelfAbove: (number | null)[] = Array(n).fill(null); // bottom face z of shelf over section i
  const addFixedShelf = (key: string, z0: number, name = 'Fixed Shelf'): void => {
    fixedShelfCount++;
    add({
      key,
      role: 'fixed-shelf',
      name,
      slot: 'carcass',
      box: box(t - hd, iy0, z0, Wi + 2 * hd, Di, t),
      thicknessAxis: 'z',
      lengthAxis: 'x',
      edges: { y0: cb },
      comment: housedNote('between-sides'),
    });
  };
  for (let i = 0; i < n - 1; i++) {
    const upper = layout[i].s.kind === 'appliance';
    const lower = layout[i + 1].s.kind === 'appliance';
    if (!upper && !lower) continue;
    const b = layout[i].zBot - gap / 2;
    if (upper) {
      addFixedShelf(`fixed-${i}`, b - t);
      shelfBelow[i] = b;
      shelfAbove[i + 1] = b - t;
    } else {
      addFixedShelf(`fixed-${i}`, b);
      shelfBelow[i] = b + t;
      shelfAbove[i + 1] = b;
    }
  }

  const zRule: 'top' | 'bottom' | number = cab.category === 'wall' ? 'bottom' : benchCab ? 'top' : 1050;
  const pullEdge: 'top' | 'bottom' = cab.category === 'wall' ? 'bottom' : 'top';
  const addHandle = (partKey: string, pb: PartBox, orientation: 'door' | 'drawer', style: HandleStyle, hinge?: 'left' | 'right'): void => {
    const visual = handleVisual(style, pb, 'y-', orientation, hinge, zRule);
    if (!visual) return;
    addHw({ key: `${partKey}-handle`, hardwareId: handleHardwareId(style), qty: 1, partKey, visual });
  };

  const addShelves = (i: number, lo: number, hi: number, count: number): void => {
    const setback = r.shelfFrontSetback;
    const c = r.shelfSideClearance;
    if (Di - setback < 50) {
      warnings.push('Interior is too shallow for adjustable shelves.');
      return;
    }
    const spacing = (hi - lo) / (count + 1);
    let placed = 0;
    for (let j = 1; j <= count; j++) {
      let zc = lo + j * spacing;
      if (r.systemHolePitch > 0) zc = iz0 + Math.round((zc - iz0) / r.systemHolePitch) * r.systemHolePitch;
      zc = clamp(zc, lo + t, hi - t);
      add({
        key: `shelf-${i}-${j}`,
        role: 'shelf',
        name: 'Adjustable Shelf',
        slot: 'carcass',
        box: box(ix0 + c, iy0 + setback, zc - t / 2, Wi - 2 * c, Di - setback, t),
        thicknessAxis: 'z',
        lengthAxis: 'x',
        edges: { y0: cb },
      });
      placed++;
    }
    if (placed) addHw({ key: `shelf-pins-${i}`, hardwareId: 'shelf-pin-5', qty: placed * 4 });
  };

  const addInterior = (L: SectionLayout, lo: number, hi: number): void => {
    if (L.s.interior === 'hanging' && hi - lo > 700) {
      const shelfZ = hi - 280 - t;
      addFixedShelf(`hang-shelf-${L.i}`, shelfZ, 'Fixed Shelf (hanging)');
      const railZ = shelfZ - 60;
      addHw({
        key: `rail-${L.i}`,
        hardwareId: 'hanging-rail-oval',
        qty: 1,
        detail: `${fmt(Wi - 2)} mm`,
        visual: { kind: 'tube', center: { x: W / 2, y: iy0 + Di / 2, z: railZ }, axis: 'x', length: Wi - 2 },
      });
      addHw({ key: `rail-supports-${L.i}`, hardwareId: 'rail-support', qty: 2 });
      return;
    }
    const count = Math.max(0, Math.floor(L.s.shelves ?? 0));
    if (count > 0) addShelves(L.i, lo, hi, count);
  };

  let drawerNo = 0;
  for (const L of layout) {
    const { s, i } = L;
    const lo = shelfBelow[i] ?? bandBot(i);
    const hi = shelfAbove[i] ?? bandTop(i);
    if (s.kind === 'doors') {
      const count = s.doorCount && s.doorCount !== 'auto' ? s.doorCount : zoneW <= r.maxSingleDoorWidth ? 1 : 2;
      const dw = (zoneW - (count - 1) * gap) / count;
      if (dw < 100) warnings.push(`Doors are only ${fmt(dw)} mm wide.`);
      for (let j = 0; j < count; j++) {
        const x0 = fx0 + j * (dw + gap);
        const key = `door-${i}-${j}`;
        const plan = planFront(cab, `${s.id}:${j}`, box(x0, fy0, L.zBot, dw, ft, L.h), 'y-', count === 1 ? (s.hinge ?? p.hingeSide) : j === 0 ? 'left' : 'right', pullEdge);
        const hinge = plan.hinge ?? 'left';
        const door = add({
          key,
          role: 'door',
          name: `Door (${hinge === 'left' ? 'L' : 'R'})`,
          slot: 'front',
          box: plan.box,
          thicknessAxis: 'y',
          lengthAxis: 'z',
          edges: allEdges('y', fb),
          hinge,
          frontKey: plan.frontKey,
          frontProfile: plan.profile,
          facing: 'y-',
          pullEdge: plan.pullEdge,
          materialId: plan.materialId,
          comment: plan.comment,
        });
        const hc = hingeCount(r, plan.box.sz);
        addHw({
          key: `${key}-hinges`,
          hardwareId: overlay ? 'hinge-110-softclose' : 'hinge-110-inset',
          qty: hc,
          partKey: key,
          positions: hingePositions(plan.box.sz, hc, r.hingeEdgeOffset),
          detail: `${hinge} hand`,
        });
        addHw({ key: `${key}-plates`, hardwareId: 'hinge-plate-0', qty: hc, partKey: key });
        addHandle(key, door.box, 'door', plan.handle, hinge);
      }
      addInterior(L, lo, hi);
    } else if (s.kind === 'open') {
      addInterior(L, lo, hi);
    } else if (s.kind === 'appliance') {
      appliances.push({ key: `appliance-${i}`, label: s.appliance ?? 'Appliance', box: box(ix0, iy0, lo, Wi, Di, hi - lo) });
    } else {
      drawerNo++;
      const key = `drawer-${i}`;
      const plan = planFront(cab, s.id, box(fx0, fy0, L.zBot, zoneW, ft, L.h), 'y-', undefined, 'top');
      const front = add({
        key,
        role: 'drawer-front',
        name: 'Drawer Front',
        slot: 'front',
        box: plan.box,
        thicknessAxis: 'y',
        lengthAxis: 'z',
        edges: allEdges('y', fb),
        frontKey: plan.frontKey,
        frontProfile: plan.profile,
        facing: 'y-',
        pullEdge: plan.pullEdge,
        materialId: plan.materialId,
        comment: plan.comment,
      });
      addHandle(key, front.box, 'drawer', plan.handle);

      const tbx = r.drawerBoxThickness;
      const boxW = Wi - 2 * r.runnerSideClearance;
      const usableDepth = Di - r.drawerRearClearance;
      const runner = [...r.runnerLengths].sort((a, b) => b - a).find((l) => l <= usableDepth);
      const boxZ0 = lo + 12;
      const boxH = Math.floor(Math.min(L.h - r.drawerHeightClearance, hi - lo - 22));
      if (!runner) {
        warnings.push(`Drawer ${drawerNo}: ${fmt(usableDepth)} mm of interior depth is too shallow for the available runners.`);
      } else if (boxH < 60) {
        warnings.push(`Drawer ${drawerNo}: front is too shallow for a drawer box (${fmt(boxH)} mm).`);
      } else if (boxW < 2 * tbx + 60) {
        warnings.push(`Drawer ${drawerNo}: cabinet is too narrow for a drawer box.`);
      } else {
        const bx0 = ix0 + r.runnerSideClearance;
        const by0 = iy0;
        const g = r.drawerBottomGroove;
        const boxSpecs: PartSpec[] = [
          { key: `${key}-side-l`, role: 'drawer-side', name: 'Drawer Side', slot: 'drawerBox', box: box(bx0, by0, boxZ0, tbx, runner, boxH), thicknessAxis: 'x', lengthAxis: 'y', edges: { z1: cb } },
          { key: `${key}-side-r`, role: 'drawer-side', name: 'Drawer Side', slot: 'drawerBox', box: box(bx0 + boxW - tbx, by0, boxZ0, tbx, runner, boxH), thicknessAxis: 'x', lengthAxis: 'y', edges: { z1: cb } },
          { key: `${key}-sub-front`, role: 'drawer-sub-front', name: 'Drawer Box Front', slot: 'drawerBox', box: box(bx0 + tbx, by0, boxZ0, boxW - 2 * tbx, tbx, boxH), thicknessAxis: 'y', lengthAxis: 'x', edges: { z1: cb } },
          { key: `${key}-back`, role: 'drawer-back', name: 'Drawer Box Back', slot: 'drawerBox', box: box(bx0 + tbx, by0 + runner - tbx, boxZ0, boxW - 2 * tbx, tbx, boxH), thicknessAxis: 'y', lengthAxis: 'x', edges: { z1: cb } },
          {
            key: `${key}-bottom`,
            role: 'drawer-bottom',
            name: 'Drawer Bottom',
            slot: 'drawerBottom',
            box: box(bx0 + tbx - g, by0 + tbx - g, boxZ0 + r.drawerBottomRecess, boxW - 2 * tbx + 2 * g, runner - 2 * tbx + 2 * g, r.drawerBottomThickness),
            thicknessAxis: 'z',
            comment: `In ${fmt(g)} mm groove`,
          },
        ];
        boxSpecs.forEach(add);
        addHw({ key: `${key}-runners`, hardwareId: 'runner-ballbearing', qty: 1, detail: `${runner} mm`, partKey: key });
      }
    }
  }

  // ── Kick and legs ──
  if (k > 0) {
    if (p.kickboard !== false) add({
      key: 'kick',
      role: 'kick',
      name: 'Kickboard',
      slot: 'kick',
      box: box(0, r.kickSetback, 0, W, r.kickThickness, k - r.kickTopGap),
      thicknessAxis: 'y',
      lengthAxis: 'x',
    });
    addHw({ key: 'legs', hardwareId: 'leg-adjustable', qty: W <= 600 ? 4 : W <= 1200 ? 6 : 8 });
  }

  // ── Carcass fasteners from the joints the construction actually has ──
  const per = (len: number) => fastenersForJoint(r, len);
  let joints = 2 * per(horizDepth);
  joints += topFull ? 2 * per(horizDepth) : 4 * per(railW);
  joints += fixedShelfCount * 2 * per(Di);
  addHw({ key: 'fasteners', hardwareId: `fastener-${r.joinery}`, qty: joints, detail: 'carcass joints' });
  if (r.backMethod === 'inset') addHw({ key: 'back-fixings', hardwareId: 'fastener-back-screw', qty: 2 * per(sideZ1 - sideZ0) });
  if (r.backMethod === 'applied') addHw({ key: 'back-fixings', hardwareId: 'fastener-back-nail', qty: Math.ceil((2 * (W + H - k)) / 150) });

  checkStock(parts, ctx.materials, warnings);
  return { itemId: cab.id, parts, hardware, appliances, warnings, invalid: false, bounds };
}

/** Warn when a part's thickness is not a stocked thickness of its material. */
export function checkStock(parts: Part[], materials: ReadonlyMap<Id, MaterialDef>, warnings: string[]): void {
  const seen = new Set<string>();
  for (const part of parts) {
    const m = materials.get(part.materialId);
    if (!m) {
      const key = `missing:${part.materialId}`;
      if (!seen.has(key)) warnings.push(`Material "${part.materialId}" is not in this project (${part.name}).`);
      seen.add(key);
      continue;
    }
    if (m.thicknesses.length && !m.thicknesses.some((th) => Math.abs(th - part.thickness) < 0.01)) {
      const key = `${m.id}:${part.thickness}`;
      if (!seen.has(key)) warnings.push(`${m.name} isn't stocked in ${fmt(part.thickness)} mm (${part.name}). Pick a ${fmt(part.thickness)} mm material.`);
      seen.add(key);
    }
  }
}
