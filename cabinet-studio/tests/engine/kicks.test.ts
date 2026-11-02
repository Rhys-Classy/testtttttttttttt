import { describe, expect, it } from 'vitest';
import {
  activeRoom,
  addItem,
  createProject,
  replaceAutoTops,
  autoKicks,
  buildPanel,
  convexOverlap,
  createRoom,
  DEFAULT_AUTO_KICKS,
  DEFAULT_MATERIAL_ASSIGNMENT,
  DEFAULT_RULES,
  itemExtents,
  worldFootprint,
  type CabinetItem,
  type EndState,
  type PanelItem,
  type Room,
} from '@engine/index';
import { build, byRole, cabinet, materials } from './helpers';

const end = (left: boolean, right: boolean): EndState => ({ left, right, leftCovered: !left, rightCovered: !right });

function setup(specs: { c: CabinetItem; x: number; y?: number; rot?: number; el?: number; ends?: [boolean, boolean] }[]) {
  const items = specs.map(({ c, x, y = 0, rot = 0, el = 0 }, i) => ({ ...c, id: `C${i + 1}`, placement: { x, y, rotation: rot, elevation: el } }));
  const room: Room = { ...createRoom('T', 6000, 4000, 2400, 100), items };
  const ends = new Map(specs.map((s, i) => [`C${i + 1}`, end(...(s.ends ?? [false, false]))]));
  return { room, ends };
}
const run = (r: Room, e: Map<string, EndState>, s = DEFAULT_AUTO_KICKS) => {
  let n = 0;
  return autoKicks(r, e, DEFAULT_RULES, s, (p) => `${p}${++n}`);
};
const base = (w = 600) => cabinet('base-1-door', { width: w });
const fp = (p: PanelItem) => worldFootprint(p.placement, itemExtents(p, 0));

describe('auto kickboards', () => {
  it('three touching base cabinets give one kick', () => {
    const { room, ends } = setup([{ c: base(), x: 0 }, { c: base(), x: 600 }, { c: base(), x: 1200 }]);
    const { panels, cabinetIds } = run(room, ends);
    expect(panels).toHaveLength(1);
    const k = panels[0];
    expect(k.panelType).toBe('kick');
    expect(k.auto).toBe(true);
    expect(k.width).toBe(1800);
    expect(k.depth).toBe(16);
    expect(k.height).toBe(150);
    expect(k.placement).toMatchObject({ x: 0, y: 50, elevation: 0 });
    expect(cabinetIds.sort()).toEqual(['C1', 'C2', 'C3']);
  });

  it('a gap makes two runs', () => {
    const { room, ends } = setup([{ c: base(), x: 0 }, { c: base(), x: 603 }]);
    expect(run(room, ends).panels.map((p) => p.width)).toEqual([600, 600]);
  });

  it('exposed ends get returns and shorten the front kick', () => {
    const { room, ends } = setup([{ c: base(), x: 0, ends: [true, true] }]);
    const { panels } = run(room, ends);
    const front = panels.filter((p) => p.name === 'Kickboard');
    const rets = panels.filter((p) => p.name === 'Kickboard return');
    expect(front).toHaveLength(1);
    expect(front[0].width).toBe(500);
    expect(front[0].placement.x).toBe(50);
    expect(rets).toHaveLength(2);
    const rot = front[0].placement.rotation;
    const u = (q: { x: number; y: number }) => q.x * Math.cos(rot) + q.y * Math.sin(rot);
    const v = (q: { x: number; y: number }) => -q.x * Math.sin(rot) + q.y * Math.cos(rot);
    const range = (f: (q: { x: number; y: number }) => number, p: PanelItem) => {
      const vals = fp(p).map(f);
      return [Math.min(...vals), Math.max(...vals)];
    };
    const [frontU0, frontU1] = range(u, front[0]);
    const frontVMax = range(v, front[0])[1];
    const retRanges = rets.map((r) => range(u, r)).sort((a, b) => a[0] - b[0]);
    expect(retRanges[0][0]).toBeCloseTo(frontU0, 2);
    expect(retRanges[0][1]).toBeCloseTo(frontU0 + 16, 2);
    expect(retRanges[1][0]).toBeCloseTo(frontU1 - 16, 2);
    expect(retRanges[1][1]).toBeCloseTo(frontU1, 2);
    for (const r of rets) expect(range(v, r)[0]).toBeCloseTo(frontVMax, 2);
    for (const r of rets) {
      expect(r.width).toBe(580 - 50 - 16);
      const ys = fp(r).map((p) => p.y);
      expect(Math.min(...ys)).toBeCloseTo(66, 6);
      expect(Math.max(...ys)).toBeCloseTo(580, 6);
      expect(convexOverlap(fp(r), fp(front[0]))).toBe(false);
    }
    expect(run(room, ends, { ...DEFAULT_AUTO_KICKS, returns: false }).panels).toHaveLength(1);
  });

  it('left L corner: long kick runs through, return kick butts into it', () => {
    const corner = cabinet('base-corner-l');
    expect(corner.params.depth).toBe(580);
    expect(corner.params.corner!.returnWidth).toBe(900);
    const { room, ends } = setup([
      { c: corner, x: 0 },
      { c: base(), x: 900, y: 320, ends: [false, true] },
      { c: base(), x: 580, y: -600, rot: Math.PI / 2, ends: [true, false] },
    ]);
    const { panels } = run(room, ends);
    const rets = panels.filter((p) => p.name === 'Kickboard return');
    const fronts = panels.filter((p) => p.name === 'Kickboard');
    expect(rets).toHaveLength(2);
    expect(fronts).toHaveLength(2);
    const long = fronts.find((p) => p.placement.rotation === 0)!;
    const ret = fronts.find((p) => p !== long)!;
    expect(long.placement.x).toBeCloseTo(580 - 66, 6);
    expect(long.placement.y).toBeCloseTo(370, 6);
    expect(long.width).toBeCloseTo(1450 - 514, 6);
    expect(ret.width).toBeCloseTo(370 + 550, 6);
    expect(convexOverlap(fp(long), fp(ret))).toBe(false);
    const ys = fp(ret).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(370, 6);
  });

  it('replaceAutoTops keeps auto kicks and replaces auto benchtops', () => {
    const { room, ends } = setup([{ c: base(), x: 0 }]);
    const kick = run(room, ends).panels[0];
    const oldTop: PanelItem = { ...kick, id: 'OLDTOP', panelType: 'benchtop' };
    const newTop: PanelItem = { ...kick, id: 'NEWTOP', panelType: 'benchtop' };
    let doc = createProject();
    doc = addItem(doc, kick);
    doc = addItem(doc, oldTop);
    doc = replaceAutoTops(doc, [newTop]);
    const ids = activeRoom(doc).items.map((i) => i.id);
    expect(ids).toContain(kick.id);
    expect(ids).toContain('NEWTOP');
    expect(ids).not.toContain('OLDTOP');
  });

  it('long runs split into equal pieces', () => {
    const { room, ends } = setup(Array.from({ length: 7 }, (_, i) => ({ c: base(), x: i * 600 })));
    const { panels } = run(room, ends);
    expect(panels.map((p) => p.width)).toEqual([2100, 2100]);
    expect(panels[1].placement.x).toBe(2100);
  });

  it('ignores wall cabinets', () => {
    const { room, ends } = setup([{ c: cabinet('wall-1-door'), x: 0, y: 0, el: 1400 }]);
    expect(run(room, ends).panels).toHaveLength(0);
  });

  it('kickboard:false drops the cabinet kick but keeps legs', () => {
    const b = build(base(), {}, { left: false, right: false });
    expect(byRole(b, 'kick')).toHaveLength(1);
    const c = build(cabinet('base-1-door', { kickboard: false }));
    expect(byRole(c, 'kick')).toHaveLength(0);
    expect(c.hardware.some((h) => h.hardwareId === 'leg-adjustable')).toBe(true);
    const k = build(cabinet('base-corner-l', { kickboard: false }));
    expect(byRole(k, 'kick')).toHaveLength(0);
    expect(k.hardware.some((h) => h.hardwareId === 'leg-adjustable')).toBe(true);
  });

  it('buildPanel of a kick panel yields one kick part', () => {
    const { room, ends } = setup([{ c: base(), x: 0 }]);
    const b = buildPanel(run(room, ends).panels[0], { rules: DEFAULT_RULES, materialFor: (s) => DEFAULT_MATERIAL_ASSIGNMENT[s], materials });
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0].role).toBe('kick');
  });
});
