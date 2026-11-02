import { describe, expect, it } from 'vitest';
import { hingeCount, hingePositions, makePart, box, DEFAULT_RULES, fastenersForJoint } from '@engine/index';
import { build, byRole, cabinet, part } from './helpers';

const pctx = { itemId: 'i', itemLabel: 'C1', materialFor: () => 'mel-carcass-white', hasGrain: () => false };

describe('cut sizes', () => {
  it('deducts banding from the opposite dimension (580 × 870, one long edge + both ends → 579 × 868)', () => {
    const p = makePart(
      { key: 'p', role: 'side', name: 'End', slot: 'carcass', box: box(0, 0, 0, 16, 580, 870), thicknessAxis: 'x', lengthAxis: 'z', edges: { y0: 1, z0: 1, z1: 1 } },
      pctx,
    );
    expect(p.length).toBe(870);
    expect(p.width).toBe(580);
    expect(p.cutLength).toBe(868);
    expect(p.cutWidth).toBe(579);
    expect(p.banding).toEqual({ l1: 1, l2: 0, w1: 1, w2: 1 });
  });

  it('uses the longer in-plane side as length when the material has no grain', () => {
    const p = makePart({ key: 'p', role: 'shelf', name: 'S', slot: 'carcass', box: box(0, 0, 0, 300, 800, 16), thicknessAxis: 'z', lengthAxis: 'x' }, pctx);
    expect(p.length).toBe(800);
    expect(p.width).toBe(300);
  });
});

describe('base 2-door cabinet, default rules (16 mm carcass, 16 mm inset back, rails)', () => {
  const b = build(cabinet('base-2-door'));

  it('builds a valid cabinet', () => {
    expect(b.invalid).toBe(false);
    expect(b.warnings).toEqual([]);
  });

  it('sides run the carcass height above the kick at full depth', () => {
    const s = part(b, 'side-l');
    expect(s.box).toEqual({ x: 0, y: 0, z: 150, sx: 16, sy: 580, sz: 720 });
    expect([s.length, s.width, s.thickness]).toEqual([720, 580, 16]);
    expect([s.cutLength, s.cutWidth]).toEqual([720, 579]);
    expect(part(b, 'side-r').box.x).toBe(900 - 16);
  });

  it('bottom and rails sit between the sides in front of the back', () => {
    const bottom = part(b, 'bottom');
    expect(bottom.box).toEqual({ x: 16, y: 0, z: 150, sx: 868, sy: 564, sz: 16 });
    expect(part(b, 'rail-front').box).toEqual({ x: 16, y: 0, z: 854, sx: 868, sy: 100, sz: 16 });
    expect(part(b, 'rail-back').box).toEqual({ x: 16, y: 464, z: 854, sx: 868, sy: 100, sz: 16 });
  });

  it('back is captured between the sides', () => {
    expect(part(b, 'back').box).toEqual({ x: 16, y: 564, z: 150, sx: 868, sy: 16, sz: 720 });
  });

  it('two doors split the overlay zone with a 3 mm gap', () => {
    const doors = byRole(b, 'door');
    expect(doors).toHaveLength(2);
    // Zone = 900 − 2 × 1.5 = 897; (897 − 3) / 2 = 447. Height = 870 − 1.5 − 150 = 718.5.
    expect(doors.map((d) => d.box.sx)).toEqual([447, 447]);
    expect(doors[0].box).toMatchObject({ x: 1.5, y: -18, z: 150, sz: 718.5 });
    expect(doors[1].box.x).toBe(1.5 + 447 + 3);
    expect(doors.map((d) => d.hinge)).toEqual(['left', 'right']);
    expect([doors[0].cutLength, doors[0].cutWidth]).toEqual([716.5, 445]);
  });

  it('places hinges and handles for each door', () => {
    const hinges = b.hardware.filter((h) => h.type === 'hinge');
    expect(hinges.map((h) => h.qty)).toEqual([2, 2]);
    expect(hinges[0].positions).toEqual([100, 618.5]);
    expect(b.hardware.filter((h) => h.type === 'handle')).toHaveLength(2);
  });

  it('adjustable shelf clears the sides and sets back from the front', () => {
    const s = byRole(b, 'shelf');
    expect(s).toHaveLength(1);
    expect(s[0].box).toMatchObject({ x: 17, y: 20, sx: 866, sy: 544, sz: 16 });
    // Shelf centre sits on the 32 mm system grid measured from the interior bottom.
    expect(((s[0].box.z + 8 - 166) / 32) % 1).toBe(0);
  });

  it('kickboard spans the width, set back 50 mm', () => {
    expect(part(b, 'kick').box).toEqual({ x: 0, y: 50, z: 0, sx: 900, sy: 16, sz: 150 });
    expect(b.hardware.find((h) => h.type === 'leg')?.qty).toBe(6);
  });
});

describe('parametric resizing', () => {
  it('widening a cabinet resizes bottom, rails, back, shelves and doors but not the sides', () => {
    const a = build(cabinet('base-2-door'));
    const w = build(cabinet('base-2-door', { width: 1200 }));
    expect(part(w, 'side-l').box).toEqual(part(a, 'side-l').box);
    expect(part(w, 'side-r').box.x).toBe(1200 - 16);
    expect(part(w, 'bottom').box.sx).toBe(1168);
    expect(part(w, 'rail-front').box.sx).toBe(1168);
    expect(part(w, 'back').box.sx).toBe(1168);
    expect(byRole(w, 'shelf')[0].box.sx).toBe(1166);
    expect(byRole(w, 'door').map((d) => d.box.sx)).toEqual([597, 597]);
  });

  it('taller and deeper cabinets update sides, back, doors and interior', () => {
    const b = build(cabinet('base-2-door', { height: 900, depth: 600 }));
    expect(part(b, 'side-l').box).toMatchObject({ sy: 600, sz: 750 });
    expect(part(b, 'back').box).toMatchObject({ y: 584, sz: 750 });
    expect(part(b, 'bottom').box.sy).toBe(584);
    expect(byRole(b, 'door')[0].box.sz).toBe(748.5);
  });

  it('chooses one or two doors from the zone width', () => {
    expect(byRole(build(cabinet('base-1-door', { width: 600 })), 'door')).toHaveLength(1);
    expect(byRole(build(cabinet('base-1-door', { width: 650 })), 'door')).toHaveLength(2);
  });

  it('reports impossible sizes instead of producing broken geometry', () => {
    const b = build(cabinet('base-1-door', { width: 40 }));
    expect(b.invalid).toBe(true);
    expect(b.parts).toEqual([]);
    expect(b.warnings[0]).toMatch(/Width must be at least 72 mm/);
  });
});

describe('drawers', () => {
  const b = build(cabinet('base-3-drawer'));

  it('splits fixed and auto drawer heights to fill the front zone', () => {
    const fronts = byRole(b, 'drawer-front');
    // 718.5 zone − 2 × 3 gaps = 712.5; 180 fixed → 266.25 each.
    expect(fronts.map((f) => f.box.sz)).toEqual([180, 266.25, 266.25]);
    expect(fronts[0].box.z + fronts[0].box.sz).toBe(868.5);
    expect(fronts[2].box.z).toBeCloseTo(150, 6);
  });

  it('builds a drawer box per drawer sized from the runner clearance and length', () => {
    const sides = byRole(b, 'drawer-side');
    expect(sides).toHaveLength(6);
    // Interior 568 wide → box 568 − 2 × 12.7 = 542.6; interior depth 564 − 20 → 500 mm runner.
    const left = part(b, 'drawer-0-side-l');
    const right = part(b, 'drawer-0-side-r');
    expect(right.box.x + right.box.sx - left.box.x).toBeCloseTo(542.6, 6);
    expect(left.box.sy).toBe(500);
    expect(left.box.sz).toBe(140);
    expect(b.hardware.filter((h) => h.type === 'runner').map((h) => h.detail)).toEqual(['500 mm', '500 mm', '500 mm']);
    const bottom = part(b, 'drawer-0-bottom');
    expect(bottom.box.sx).toBeCloseTo(542.6 - 32 + 12, 6);
    expect(bottom.slot).toBe('drawerBottom');
  });

  it('flags fronts that cannot fit', () => {
    const c = cabinet('base-3-drawer');
    const many = { ...c, params: { ...c.params, fronts: Array.from({ length: 14 }, (_, i) => ({ id: `f${i}`, kind: 'drawer' as const, height: null })) } };
    const r = build(many);
    expect(r.invalid).toBe(true);
    expect(r.warnings[0]).toMatch(/fronts don't fit/);
  });
});

describe('construction methods are data, not code', () => {
  it('grooved 3 mm back: back in grooves, horizontals full depth, stock warning for the wrong board', () => {
    const b = build(cabinet('base-2-door'), { backThickness: 3, backMethod: 'groove' });
    expect(part(b, 'back').box).toEqual({ x: 8, y: 580 - 18 - 3, z: 158, sx: 884, sy: 3, sz: 712 });
    expect(part(b, 'bottom').box.sy).toBe(580);
    expect(part(b, 'rail-back').box.y).toBe(580 - 18 - 3 - 100);
    expect(b.warnings.some((w) => /Carcass White isn't stocked in 3 mm/.test(w))).toBe(true);
  });

  it('housed joints lengthen bottoms and tops by the housing depth each side', () => {
    const b = build(cabinet('wall-2-door'), { carcassThickness: 18, housingDepth: 6 });
    expect(part(b, 'bottom').box).toMatchObject({ x: 12, sx: 900 - 36 + 12 });
    expect(part(b, 'top').box).toMatchObject({ x: 12, sx: 900 - 36 + 12 });
    expect(part(b, 'bottom').comment).toMatch(/Housed 6 mm/);
  });

  it('applied back shortens sides and horizontals by the back thickness', () => {
    const b = build(cabinet('wall-2-door'), { backMethod: 'applied', backThickness: 6 });
    expect(part(b, 'side-l').box.sy).toBe(294);
    expect(part(b, 'back').box).toEqual({ x: 0, y: 294, z: 0, sx: 900, sy: 6, sz: 750 });
  });

  it('full-width bottom shortens the sides', () => {
    const b = build(cabinet('wall-2-door'), { bottomJoint: 'full-width' });
    expect(part(b, 'bottom').box).toMatchObject({ x: 0, sx: 900 });
    expect(part(b, 'side-l').box).toMatchObject({ z: 16, sz: 750 - 16 });
  });

  it('inset fronts sit inside the carcass opening', () => {
    const b = build(cabinet('wall-1-door'), { frontStyle: 'inset' });
    const d = byRole(b, 'door')[0];
    expect(d.box).toMatchObject({ x: 19, y: 0, z: 19, sx: 450 - 38, sz: 750 - 38 });
    expect(b.hardware.find((h) => h.type === 'hinge')?.hardwareId).toBe('hinge-110-inset');
  });

  it('joinery method selects the fastener and joints set the count', () => {
    expect(fastenersForJoint(DEFAULT_RULES, 564)).toBe(4);
    expect(fastenersForJoint(DEFAULT_RULES, 100)).toBe(2);
    const b = build(cabinet('base-2-door'), { joinery: 'dowel' });
    const f = b.hardware.find((h) => h.key === 'fasteners');
    expect(f?.hardwareId).toBe('fastener-dowel');
    expect(f?.qty).toBe(2 * 4 + 4 * 2);
  });
});

describe('ends, blind corners, appliances, hanging', () => {
  it('finished ends use the front material and band three edges', () => {
    const b = build(cabinet('base-1-door'), {}, { left: true, right: false });
    const l = part(b, 'side-l');
    expect(l.slot).toBe('front');
    expect(l.materialId).toBe('mel-polar-white-matt');
    expect(l.name).toBe('Finished End (L)');
    expect(part(b, 'side-r').slot).toBe('carcass');
  });

  it('blind corner: blind panel plus a single door in the remaining zone', () => {
    const b = build(cabinet('base-blind-corner'));
    const blind = part(b, 'blind');
    expect(blind.box).toMatchObject({ x: 1.5, sx: 450 - 1.5 - 1.5 });
    const door = byRole(b, 'door');
    expect(door).toHaveLength(1);
    expect(door[0].box).toMatchObject({ x: 451.5, sx: 1000 - 1.5 - 451.5 });
    expect(door[0].hinge).toBe('right');
  });

  it('oven tower: fixed shelves above and below the oven opening', () => {
    const b = build(cabinet('tall-oven'));
    const fixed = byRole(b, 'fixed-shelf');
    expect(fixed).toHaveLength(2);
    expect(b.appliances).toHaveLength(1);
    const a = b.appliances[0].box;
    const below = Math.min(...fixed.map((f) => f.box.z));
    const above = Math.max(...fixed.map((f) => f.box.z));
    expect(a.z).toBeCloseTo(below + 16, 6);
    expect(a.z + a.sz).toBeCloseTo(above, 6);
    expect(a.sz).toBeGreaterThan(595 - 16);
  });

  it('hanging wardrobe gets a top shelf and a rail', () => {
    const b = build(cabinet('wardrobe-hanging'));
    expect(byRole(b, 'fixed-shelf')).toHaveLength(1);
    const rail = b.hardware.find((h) => h.type === 'hanging-rail');
    expect(rail?.visual?.kind).toBe('tube');
  });

  it('hinge counts follow the door-height rules', () => {
    expect(hingeCount(DEFAULT_RULES, 718)).toBe(2);
    expect(hingeCount(DEFAULT_RULES, 1400)).toBe(3);
    expect(hingeCount(DEFAULT_RULES, 1948)).toBe(4);
    expect(hingeCount(DEFAULT_RULES, 2400)).toBe(5);
    expect(hingePositions(1000, 3, 100)).toEqual([100, 500, 900]);
  });
});

describe('every template builds', () => {
  it('all library cabinets build without errors and with real parts', async () => {
    const { CABINET_TEMPLATES } = await import('@engine/index');
    for (const t of CABINET_TEMPLATES) {
      const b = build(cabinet(t.id));
      expect(b.invalid, `${t.id}: ${b.warnings.join('; ')}`).toBe(false);
      expect(b.warnings, t.id).toEqual([]);
      expect(b.parts.length, t.id).toBeGreaterThan(4);
      for (const p of b.parts) {
        expect(p.box.sx > 0 && p.box.sy > 0 && p.box.sz > 0, `${t.id} ${p.key}`).toBe(true);
        expect(p.cutLength > 0 && p.cutWidth > 0, `${t.id} ${p.key}`).toBe(true);
      }
    }
  });
});
