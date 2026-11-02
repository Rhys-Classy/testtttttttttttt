// L-shaped corner cabinets (base and wall).
//
// Local frame (left-hand corner, viewed from the room facing the back wall):
//   wing A runs along the back wall:  x ∈ [0, W],  y ∈ [R − D, R]
//   wing B runs along the left wall:  x ∈ [0, D],  y ∈ [0, R]
//   W = width, R = return width, D = wing depth. The back wall is at y = R and the
//   side wall at x = 0. Fronts: wing A faces −y at y = R − D, wing B faces +x at x = D.
// Right-hand corners are built as left-hand and mirrored in x, so both are exact.

import { HARDWARE } from '../library/hardware';
import { clamp, type Vec2 } from '../math/vec';
import type { CabinetItem, HingeSide } from '../model/types';
import { checkStock, fastenersForJoint, hingeCount, hingePositions, type BuildContext } from './build-cabinet';
import { handleHardwareId, handleVisual, planFront, type Facing } from './fronts';
import { box, makePart, type EdgeId, type HardwarePlacement, type ItemBuild, type Part, type PartBox, type PartContext, type PartSpec } from './parts';

export function validateCorner(cab: CabinetItem, t: number): string[] {
  const p = cab.params;
  const c = p.corner!;
  const out: string[] = [];
  for (const [n, v] of [
    ['Width', p.width],
    ['Return width', c.returnWidth],
    ['Depth', p.depth],
    ['Height', p.height],
  ] as const) {
    if (!Number.isFinite(v)) out.push(`${n} must be a number.`);
  }
  if (out.length) return out;
  if (p.depth < 200) out.push('Corner wing depth must be at least 200 mm.');
  if (p.width < p.depth + 150) out.push(`Width must be at least ${p.depth + 150} mm (wing depth + 150).`);
  if (c.returnWidth < p.depth + 150) out.push(`Return width must be at least ${p.depth + 150} mm (wing depth + 150).`);
  if (p.height - p.kickHeight < 2 * t + 40) out.push(`Height must be at least ${p.kickHeight + 2 * t + 40} mm.`);
  if (p.kickHeight < 0) out.push('Kick height cannot be negative.');
  return out;
}

const flipHinge = (h?: HingeSide): HingeSide | undefined => (h ? (h === 'left' ? 'right' : 'left') : h);

/** Mirror a left-hand build into a right-hand one: x → W − x. */
function mirrorBuild(b: ItemBuild, W: number): ItemBuild {
  const mb = (bx: PartBox): PartBox => ({ ...bx, x: W - bx.x - bx.sx });
  const parts = b.parts.map((p) => {
    const m: Part = { ...p, box: mb(p.box), hinge: flipHinge(p.hinge) };
    if (p.facing === 'x+') m.facing = 'x-';
    else if (p.facing === 'x-') m.facing = 'x+';
    if (p.profile) {
      // Plane axes for thickness z are (x, y); x is mirrored. Reverse to stay counter-clockwise.
      const pts = p.profile.points.map((q) => ({ x: p.thicknessAxis === 'x' ? q.x : W - q.x, y: q.y })).reverse();
      const eb = p.profile.edgeBanding ? [...p.profile.edgeBanding].reverse() : undefined;
      // Reversing points shifts edge indices by one: edge i (pts i→i+1) becomes edge (n−2−i).
      const n = pts.length;
      const ebFixed = eb ? eb.map((_, i) => eb[(i + 1) % n]) : undefined;
      m.profile = { points: pts, edgeBanding: ebFixed };
    }
    if (p.name.endsWith('(L)')) m.name = p.name.replace('(L)', '(R)');
    else if (p.name.endsWith('(R)')) m.name = p.name.replace('(R)', '(L)');
    return m;
  });
  const hardware = b.hardware.map((h) => {
    const v = h.visual;
    if (!v) return h;
    const facing: Facing | undefined = v.facing === 'x+' ? 'x-' : v.facing === 'x-' ? 'x+' : v.facing;
    return { ...h, visual: { ...v, center: { ...v.center, x: W - v.center.x }, facing } };
  });
  return { ...b, parts, hardware, appliances: b.appliances.map((a) => ({ ...a, box: mb(a.box) })) };
}

export function buildCornerCabinet(cab: CabinetItem, ctx: BuildContext): ItemBuild {
  const r = ctx.rules;
  const p = cab.params;
  const c = p.corner!;
  const W = p.width;
  const R = c.returnWidth;
  const D = p.depth;
  const H = p.height;
  const k = Math.max(0, p.kickHeight);
  const t = r.carcassThickness;
  const tb = r.backThickness;
  const ft = r.frontThickness;
  const gap = r.frontGap;
  const cb = r.carcassBanding;
  const fb = r.frontBanding;
  const bounds = box(0, 0, 0, W, R, H);
  const problems = validateCorner(cab, t);
  if (problems.length) return { itemId: cab.id, parts: [], hardware: [], appliances: [], warnings: problems, invalid: true, bounds };

  const left = c.side === 'left';
  // Build left-handed; ends map to the cabinet's left/right end settings accordingly.
  const endAFinished = left ? ctx.finishedEnds.right : ctx.finishedEnds.left;
  const endBFinished = left ? ctx.finishedEnds.left : ctx.finishedEnds.right;
  const warnings: string[] = [];
  const parts: Part[] = [];
  const hardware: HardwarePlacement[] = [];
  const pctx: PartContext = { itemId: cab.id, itemLabel: cab.label, materialFor: ctx.materialFor, hasGrain: (id) => ctx.materials.get(id)?.grain ?? false };
  const add = (spec: PartSpec): Part => {
    const part = makePart(spec, pctx);
    parts.push(part);
    return part;
  };
  const addHw = (hw: Omit<HardwarePlacement, 'itemId' | 'itemLabel' | 'name' | 'type'>) => {
    const def = HARDWARE[hw.hardwareId];
    if (def) hardware.push({ ...hw, itemId: cab.id, itemLabel: cab.label, name: def.name, type: def.type });
  };
  const allFront = (th: 'x' | 'y'): Partial<Record<EdgeId, number>> => (th === 'y' ? { x0: fb, x1: fb, z0: fb, z1: fb } : { y0: fb, y1: fb, z0: fb, z1: fb });
  const Hc = H - k;

  // ── Ends ──
  add({
    key: 'end-a',
    role: 'side',
    name: endAFinished ? 'Finished End (R)' : 'End (R)',
    slot: endAFinished ? 'front' : 'carcass',
    box: box(W - t, R - D, k, t, D, Hc),
    thicknessAxis: 'x',
    lengthAxis: 'z',
    edges: endAFinished ? { y0: fb, z0: fb, z1: fb } : { y0: cb },
    comment: endAFinished ? 'Visible end — matches fronts' : undefined,
  });
  add({
    key: 'end-b',
    role: 'side',
    name: endBFinished ? 'Finished End (L)' : 'End (L)',
    slot: endBFinished ? 'front' : 'carcass',
    box: box(0, 0, k, D, t, Hc),
    thicknessAxis: 'y',
    lengthAxis: 'z',
    edges: endBFinished ? { x1: fb, z0: fb, z1: fb } : { x1: cb },
    comment: endBFinished ? 'Visible end — matches fronts' : undefined,
  });

  // ── Backs (fixed between the ends, against both walls) ──
  add({ key: 'back-a', role: 'back', name: 'Back (long)', slot: 'back', box: box(0, R - tb, k, W - t, tb, Hc), thicknessAxis: 'y', lengthAxis: 'z', comment: 'Runs into the corner' });
  add({ key: 'back-b', role: 'back', name: 'Back (return)', slot: 'back', box: box(0, t, k, tb, R - tb - t, Hc), thicknessAxis: 'x', lengthAxis: 'z', comment: 'Butts against long back' });

  // ── L-shaped bottom and top ──
  const L: Vec2[] = [
    { x: tb, y: t },
    { x: D, y: t },
    { x: D, y: R - D },
    { x: W - t, y: R - D },
    { x: W - t, y: R - tb },
    { x: tb, y: R - tb },
  ];
  const lBand = [0, cb, cb, 0, 0, 0];
  const lBox = (z: number) => box(tb, t, z, W - t - tb, R - tb - t, t);
  add({ key: 'bottom', role: 'bottom', name: 'Bottom (L-shape)', slot: 'carcass', box: lBox(k), thicknessAxis: 'z', lengthAxis: 'x', profile: { points: L, edgeBanding: lBand }, comment: 'Shaped — CNC outline' });
  add({ key: 'top', role: 'top', name: 'Top (L-shape)', slot: 'carcass', box: lBox(H - t), thicknessAxis: 'z', lengthAxis: 'x', profile: { points: L, edgeBanding: lBand }, comment: 'Shaped — CNC outline' });

  // ── Adjustable L-shaped shelves ──
  const shelves = Math.max(0, Math.floor(p.fronts[0]?.shelves ?? 0));
  const sb = r.shelfFrontSetback;
  const cl = r.shelfSideClearance;
  const iz0 = k + t;
  const iz1 = H - t;
  for (let j = 1; j <= shelves; j++) {
    let zc = iz0 + ((iz1 - iz0) * j) / (shelves + 1);
    if (r.systemHolePitch > 0) zc = iz0 + Math.round((zc - iz0) / r.systemHolePitch) * r.systemHolePitch;
    zc = clamp(zc, iz0 + t, iz1 - t);
    const S: Vec2[] = [
      { x: tb + cl, y: t + cl },
      { x: D - sb, y: t + cl },
      { x: D - sb, y: R - D + sb },
      { x: W - t - cl, y: R - D + sb },
      { x: W - t - cl, y: R - tb - cl },
      { x: tb + cl, y: R - tb - cl },
    ];
    add({
      key: `shelf-0-${j}`,
      role: 'shelf',
      name: 'Adjustable Shelf (L-shape)',
      slot: 'carcass',
      box: box(tb + cl, t + cl, zc - t / 2, W - t - cl - (tb + cl), R - tb - cl - (t + cl), t),
      thicknessAxis: 'z',
      lengthAxis: 'x',
      profile: { points: S, edgeBanding: [0, cb, cb, 0, 0, 0] },
      comment: 'Shaped — CNC outline',
    });
  }
  if (shelves) addHw({ key: 'shelf-pins-0', hardwareId: 'shelf-pin-5', qty: shelves * 6 });

  // ── Doors: B on the return wing (faces +x), A on the long wing (faces −y) ──
  const revS = r.frontRevealSide;
  const fz0 = k + r.frontRevealBottom - (cab.category === 'wall' ? r.wallFrontOverhangBottom : 0);
  const fz1 = H - r.frontRevealTop;
  const fh = fz1 - fz0;
  const zRule: 'top' | 'bottom' = cab.category === 'wall' ? 'bottom' : 'top';
  const pullEdge = zRule;
  const bifold = c.doors === 'bifold';
  const planB = planFront(cab, 'corner:b', box(D, revS, fz0, ft, R - D - revS, fh), 'x+', 'left', pullEdge);
  const planA = planFront(cab, 'corner:a', box(D + ft + gap, R - D - ft, fz0, W - revS - (D + ft + gap), ft, fh), 'y-', bifold ? 'left' : 'right', pullEdge);
  const doorSpec = (key: string, plan: typeof planA, facing: Facing, name: string): PartSpec => ({
    key,
    role: 'door',
    name,
    slot: 'front',
    box: plan.box,
    thicknessAxis: facing === 'y-' ? 'y' : 'x',
    lengthAxis: 'z',
    edges: allFront(facing === 'y-' ? 'y' : 'x'),
    hinge: plan.hinge,
    frontKey: plan.frontKey,
    frontProfile: plan.profile,
    facing,
    pullEdge: plan.pullEdge,
    materialId: plan.materialId,
    comment: [plan.comment, bifold ? 'Bi-fold pair' : undefined].filter(Boolean).join(' · ') || undefined,
  });
  const doorB = add(doorSpec('door-0-0', planB, 'x+', `Door (${planB.hinge === 'right' ? 'R' : 'L'})`));
  const doorA = add(doorSpec('door-0-1', planA, 'y-', bifold ? 'Door (bi-fold)' : `Door (${planA.hinge === 'left' ? 'L' : 'R'})`));
  const hcB = hingeCount(r, doorB.box.sz);
  addHw({ key: 'door-0-0-hinges', hardwareId: 'hinge-110-softclose', qty: hcB, partKey: 'door-0-0', positions: hingePositions(doorB.box.sz, hcB, r.hingeEdgeOffset), detail: `${planB.hinge} hand` });
  addHw({ key: 'door-0-0-plates', hardwareId: 'hinge-plate-0', qty: hcB, partKey: 'door-0-0' });
  const hcA = hingeCount(r, doorA.box.sz);
  if (bifold) {
    addHw({ key: 'door-0-1-bifold', hardwareId: 'hinge-bifold', qty: hcA, partKey: 'door-0-1', positions: hingePositions(doorA.box.sz, hcA, r.hingeEdgeOffset) });
    // A bi-fold pair is opened from the free edge of the long-wing door.
    const v = handleVisual(planA.handle, doorA.box, 'y-', 'door', 'left', zRule);
    if (v) addHw({ key: 'door-0-1-handle', hardwareId: handleHardwareId(planA.handle), qty: 1, partKey: 'door-0-1', visual: v });
  } else {
    addHw({ key: 'door-0-1-hinges', hardwareId: 'hinge-110-softclose', qty: hcA, partKey: 'door-0-1', positions: hingePositions(doorA.box.sz, hcA, r.hingeEdgeOffset), detail: `${planA.hinge} hand` });
    addHw({ key: 'door-0-1-plates', hardwareId: 'hinge-plate-0', qty: hcA, partKey: 'door-0-1' });
    const va = handleVisual(planA.handle, doorA.box, 'y-', 'door', planA.hinge, zRule);
    if (va) addHw({ key: 'door-0-1-handle', hardwareId: handleHardwareId(planA.handle), qty: 1, partKey: 'door-0-1', visual: va });
    const vb = handleVisual(planB.handle, doorB.box, 'x+', 'door', planB.hinge, zRule);
    if (vb) addHw({ key: 'door-0-0-handle', hardwareId: handleHardwareId(planB.handle), qty: 1, partKey: 'door-0-0', visual: vb });
  }

  // ── Kickboards along both fronts ──
  if (k > 0) {
    const ks = r.kickSetback;
    const kt = r.kickThickness;
    if (p.kickboard !== false) add({ key: 'kick', role: 'kick', name: 'Kickboard', slot: 'kick', box: box(D - ks - kt, R - D + ks, 0, W - (D - ks - kt), kt, k - r.kickTopGap), thicknessAxis: 'y', lengthAxis: 'x' });
    if (p.kickboard !== false) add({ key: 'kick-b', role: 'kick', name: 'Kickboard (return)', slot: 'kick', box: box(D - ks - kt, 0, 0, kt, R - D + ks, k - r.kickTopGap), thicknessAxis: 'x', lengthAxis: 'y' });
    addHw({ key: 'legs', hardwareId: 'leg-adjustable', qty: 6 });
  }

  // ── Fasteners: bottom and top to both ends, backs to the carcass ──
  const per = (len: number) => fastenersForJoint(r, len);
  addHw({ key: 'fasteners', hardwareId: `fastener-${r.joinery}`, qty: 2 * (per(D) + per(D)), detail: 'carcass joints' });
  addHw({ key: 'back-fixings', hardwareId: 'fastener-back-screw', qty: 2 * per(Hc) + per(W) + per(R) });

  checkStock(parts, ctx.materials, warnings);
  if (D - sb <= tb + cl + 20) warnings.push('Wing depth is too shallow for corner shelves.');
  const built: ItemBuild = { itemId: cab.id, parts, hardware, appliances: [], warnings, invalid: false, bounds };
  return left ? built : mirrorBuild(built, W);
}
