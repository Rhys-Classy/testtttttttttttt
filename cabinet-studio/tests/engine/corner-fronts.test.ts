import { describe, expect, it } from 'vitest';
import {
  allFaces,
  autoTops,
  buildCutlist,
  cabinetFromTemplate,
  computeWalls,
  convexOverlap,
  createRoom,
  DEFAULT_AUTO_TOPS,
  DEFAULT_SNAP,
  itemExtents,
  resolveEnds,
  snapItem,
  templateById,
  worldFootprint,
  type CabinetItem,
  type Room,
} from '@engine/index';
import { build, byRole, cabinet, materials, part } from './helpers';

describe('L-shaped corner cabinet (left hand, 900 × 900 × 580)', () => {
  const b = build(cabinet('base-corner-l'));

  it('builds valid shaped carcass parts', () => {
    expect(b.invalid).toBe(false);
    expect(b.warnings).toEqual([]);
    expect(part(b, 'end-a').box).toEqual({ x: 884, y: 320, z: 150, sx: 16, sy: 580, sz: 720 });
    expect(part(b, 'end-b').box).toEqual({ x: 0, y: 0, z: 150, sx: 580, sy: 16, sz: 720 });
    expect(part(b, 'back-a').box).toEqual({ x: 0, y: 884, z: 150, sx: 884, sy: 16, sz: 720 });
    expect(part(b, 'back-b').box).toEqual({ x: 0, y: 16, z: 150, sx: 16, sy: 868, sz: 720 });
    const bottom = part(b, 'bottom');
    expect(bottom.profile?.points).toEqual([
      { x: 16, y: 16 },
      { x: 580, y: 16 },
      { x: 580, y: 320 },
      { x: 884, y: 320 },
      { x: 884, y: 884 },
      { x: 16, y: 884 },
    ]);
    expect(bottom.profile?.edgeBanding).toEqual([0, 1, 1, 0, 0, 0]);
    // Cut blank is the bounding rectangle; the CNC cuts the outline.
    expect([bottom.cutLength, bottom.cutWidth]).toEqual([868, 868]);
    expect(byRole(b, 'shelf')[0].profile?.points.length).toBe(6);
  });

  it('places a bi-fold pair meeting at the inside corner without overlapping', () => {
    const [dB, dA] = byRole(b, 'door');
    expect(dB.box).toEqual({ x: 580, y: 1.5, z: 150, sx: 18, sy: 318.5, sz: 718.5 });
    expect(dB.facing).toBe('x+');
    expect(dA.box).toEqual({ x: 601, y: 302, z: 150, sx: 297.5, sy: 18, sz: 718.5 });
    expect(dA.facing).toBe('y-');
    expect(b.hardware.find((h) => h.hardwareId === 'hinge-bifold')?.qty).toBe(2);
    expect(b.hardware.filter((h) => h.type === 'handle')).toHaveLength(1);
  });

  it('separate doors get their own hinges and handles', () => {
    const c = cabinet('base-corner-l');
    const s = build({ ...c, params: { ...c.params, corner: { ...c.params.corner!, doors: 'separate' } } });
    expect(s.hardware.filter((h) => h.hardwareId === 'hinge-110-softclose').map((h) => h.qty)).toEqual([2, 2]);
    expect(s.hardware.filter((h) => h.type === 'handle')).toHaveLength(2);
  });

  it('right-hand corner is an exact mirror', () => {
    const c = cabinet('base-corner-l');
    const m = build({ ...c, params: { ...c.params, corner: { ...c.params.corner!, side: 'right' } } });
    expect(m.invalid).toBe(false);
    expect(part(m, 'end-a').box.x).toBe(0);
    expect(part(m, 'end-b').box).toMatchObject({ x: 320, sx: 580 });
    const dB = byRole(m, 'door')[0];
    expect(dB.box.x).toBe(900 - 580 - 18);
    expect(dB.facing).toBe('x-');
    // Outline stays counter-clockwise after mirroring.
    const pts = part(m, 'bottom').profile!.points;
    const area = pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);
    expect(area).toBeGreaterThan(0);
    expect(part(m, 'bottom').profile!.edgeBanding!.filter((e) => e > 0)).toHaveLength(2);
  });

  it('cutlist lists shaped parts with outline banding', () => {
    const groups = buildCutlist([b], materials);
    const carcass = groups.find((g) => g.materialName === 'Carcass White' && g.thickness === 16)!;
    const bottomRow = carcass.rows.find((r) => r.name === 'Bottom (L-shape)')!;
    expect(bottomRow.shaped).toBe(true);
    expect(bottomRow.banding).toBe('shaped: 2 edges');
  });

  it('rejects wings that cannot fit', () => {
    const bad = build(cabinet('base-corner-l', { width: 650 }));
    expect(bad.invalid).toBe(true);
    expect(bad.warnings[0]).toMatch(/Width must be at least 730/);
  });
});

describe('per-front overrides and profiles', () => {
  it('trims, hinge, profile and material apply to one door only', () => {
    const c = cabinet('base-2-door');
    const key = `${c.params.fronts[0].id}:0`;
    const o = build({ ...c, frontOverrides: { [key]: { trim: { left: 5, top: -2 }, hinge: 'right', profile: 'shaker', materialId: 'ven-natural-oak' } } });
    const [d0, d1] = byRole(o, 'door');
    expect(d0.box).toMatchObject({ x: 1.5 - 5, sx: 447 + 5, sz: 718.5 - 2 });
    expect(d0.name).toBe('Door (R)');
    expect(d0.frontProfile).toBe('shaker');
    expect(d0.comment).toMatch(/Shaker/);
    expect(d0.materialId).toBe('ven-natural-oak');
    expect(d0.frontKey).toBe(key);
    expect(d1.box.sx).toBe(447);
    expect(d1.frontProfile).toBe('slab');
    expect(d1.materialId).toBe('mel-polar-white-matt');
  });

  it('J-pull fronts are handleless and note the routed edge', () => {
    const c = cabinet('base-3-drawer', { profile: 'j-pull' });
    const b = build(c);
    expect(b.hardware.filter((h) => h.type === 'handle')).toHaveLength(0);
    expect(byRole(b, 'drawer-front')[0].comment).toBe('J-pull handle routed on top edge');
    const w = build(cabinet('wall-1-door', { profile: 'j-pull' }));
    expect(byRole(w, 'door')[0].comment).toMatch(/bottom edge/);
  });
});

describe('L-shaped kitchens: auto benchtops butt-join at the corner', () => {
  function kitchen(): Room {
    const r = createRoom('T', 4000, 3000, 2400, 100);
    const faces = allFaces(computeWalls(r.walls));
    const items: CabinetItem[] = [];
    const place = (tid: string, cursor: { x: number; y: number }, width?: number) => {
      const c = cabinetFromTemplate(templateById(tid)!, `C${items.length + 1}`);
      if (width) c.params.width = width;
      const res = snapItem({
        extents: itemExtents(c, 18),
        elevation: 0,
        cursor,
        rotation: 0,
        faces,
        others: items.map((o) => ({ id: o.id, placement: o.placement, extents: itemExtents(o, 18) })),
        settings: DEFAULT_SNAP,
      });
      items.push({ ...c, placement: res.placement, wallId: res.wallId });
    };
    place('base-corner-l', { x: 3550, y: 450 }); // south wall, east corner
    place('base-1-door', { x: 2800, y: 300 }, 600); // along the south wall
    place('base-1-door', { x: 3700, y: 1200 }, 600); // along the east wall
    return { ...r, items };
  }

  it('corner snaps into the corner', () => {
    const r = kitchen();
    const fp = worldFootprint(r.items[0].placement, itemExtents(r.items[0], 18));
    const xs = fp.map((p) => Math.round(p.x));
    const ys = fp.map((p) => Math.round(p.y) + 0);
    expect(Math.max(...xs)).toBe(4000);
    expect(Math.min(...ys)).toBe(0);
  });

  it('two tops, trimmed to a butt joint, never overlapping', () => {
    const r = kitchen();
    const ends = resolveEnds(r, computeWalls(r.walls));
    let n = 0;
    const tops = autoTops(r, ends, DEFAULT_AUTO_TOPS, (p) => `${p}${++n}`);
    const bt = tops.filter((t) => t.panelType === 'benchtop');
    expect(bt).toHaveLength(2);
    const fp = bt.map((t) => worldFootprint(t.placement, itemExtents(t, 0)));
    expect(convexOverlap(fp[0], fp[1])).toBe(false);
    const long = bt.find((t) => Math.abs(t.depth - 620) < 1 && t.width > 1000)!;
    expect(long.width).toBeCloseTo(900 + 600 + 20, 6);
    const ret = bt.find((t) => t !== long)!;
    // Return top runs from the long top's front edge (y = 620) to past the east cabinet.
    const ys = worldFootprint(ret.placement, itemExtents(ret, 0)).map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(620, 6);
    expect(Math.max(...ys)).toBeCloseTo(1500 + 20, 6);
    const sb = tops.filter((t) => t.panelType === 'splashback');
    expect(sb).toHaveLength(2);
    const sbFp = sb.map((t) => worldFootprint(t.placement, itemExtents(t, 0)));
    expect(convexOverlap(sbFp[0], sbFp[1])).toBe(false);
  });
});
