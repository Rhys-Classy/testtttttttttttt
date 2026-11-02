import { describe, expect, it } from 'vitest';
import {
  allFaces,
  autoTops,
  clashesWith,
  convexOverlap,
  cabinetFromTemplate,
  computeWalls,
  createRoom,
  DEFAULT_AUTO_TOPS,
  DEFAULT_SNAP,
  itemExtents,
  localToWorld2,
  rectangularWalls,
  resolveEnds,
  roomLoop,
  snapItem,
  snapOpening,
  snapWallPoint,
  templateById,
  wallPieces,
  type CabinetItem,
  type Room,
  type SnapObstacle,
} from '@engine/index';

const room = (): Room => createRoom('Test', 4000, 3000, 2400, 100);

describe('walls', () => {
  it('rectangular room: mitred interior faces are exactly the clear room size', () => {
    const r = room();
    const g = computeWalls(r.walls);
    const loop = roomLoop(r.walls);
    expect(loop).not.toBeNull();
    const interior = allFaces(g).filter((f) => loop!.interiorFaceIds.has(f.id));
    expect(interior).toHaveLength(4);
    expect(interior.map((f) => Math.round(f.length)).sort()).toEqual([3000, 3000, 4000, 4000]);
    const south = interior.find((f) => Math.abs(f.a.y) < 1e-9 && Math.abs(f.b.y) < 1e-9)!;
    expect(south.a).toEqual({ x: 0, y: 0 });
    expect(south.b).toEqual({ x: 4000, y: 0 });
    expect(south.normal).toEqual({ x: -0, y: 1 });
  });

  it('exterior faces include the corner thickness', () => {
    const g = computeWalls(rectangularWalls(4000, 3000, 2400, 100));
    const ext = allFaces(g).filter((f) => f.side === 'right');
    expect(ext.map((f) => Math.round(f.length)).sort()).toEqual([3200, 3200, 4200, 4200]);
  });

  it('a window splits the wall into solid, sill and head pieces', () => {
    const r = room();
    const g = computeWalls(r.walls).get(r.walls[0].id)!;
    const pieces = wallPieces(g, [{ id: 'o', wallId: r.walls[0].id, kind: 'window', offset: 1000, width: 1200, sill: 1000, height: 1100 }]);
    expect(pieces).toHaveLength(4);
    const sill = pieces.find((p) => p.z0 === 0 && p.z1 === 1000)!;
    const xs = sill.polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-50 + 1000, 6);
    expect(Math.max(...xs)).toBeCloseTo(-50 + 2200, 6);
    expect(pieces.some((p) => p.z0 === 2100 && p.z1 === 2400)).toBe(true);
  });

  it('a door to the floor leaves no sill piece', () => {
    const r = room();
    const g = computeWalls(r.walls).get(r.walls[1].id)!;
    const pieces = wallPieces(g, [{ id: 'o', wallId: r.walls[1].id, kind: 'door', offset: 500, width: 820, sill: 0, height: 2040 }]);
    expect(pieces).toHaveLength(3);
  });
});

describe('snapping', () => {
  const base = (w = 600): CabinetItem => {
    const c = cabinetFromTemplate(templateById('base-1-door')!, 'C1');
    return { ...c, params: { ...c.params, width: w } };
  };
  const faces = (r: Room) => allFaces(computeWalls(r.walls));
  const ext = (c: CabinetItem) => itemExtents(c, 18);

  it('attaches a cabinet to the nearest wall, back on the wall face, centred on the cursor', () => {
    const r = room();
    const c = base(600);
    const res = snapItem({ extents: ext(c), elevation: 0, cursor: { x: 1003, y: 300 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    expect(res.wallId).toBe(r.walls[0].id);
    const p = res.placement;
    const backLeft = localToWorld2(p, { x: 0, y: 580 });
    const backRight = localToWorld2(p, { x: 600, y: 580 });
    expect(backLeft.y).toBeCloseTo(0, 6);
    expect(backRight.y).toBeCloseTo(0, 6);
    // Centred on the cursor, rounded to the 10 mm grid from the wall corner.
    expect((backLeft.x + backRight.x) / 2).toBeCloseTo(1000, 6);
    // Front faces into the room.
    expect(localToWorld2(p, { x: 0, y: -18 }).y).toBeCloseTo(598, 6);
  });

  it('butts against a neighbour within the snap distance', () => {
    const r = room();
    const a = base(600);
    const first = snapItem({ extents: ext(a), elevation: 0, cursor: { x: 1000, y: 300 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    const others: SnapObstacle[] = [{ id: 'a', placement: first.placement, extents: ext(a) }];
    // Cursor 40 mm past the touching position.
    const res = snapItem({ extents: ext(a), elevation: 0, cursor: { x: 1640, y: 300 }, rotation: 0, faces: faces(r), others, settings: DEFAULT_SNAP });
    const xs = [0, 600].map((x) => localToWorld2(res.placement, { x, y: 580 }).x);
    expect(Math.min(...xs)).toBeCloseTo(1300, 6);
    expect(res.colliding).toBe(false);
  });

  it('never drops a cabinet on top of another — it moves to the nearest free side', () => {
    const r = room();
    const a = base(600);
    const first = snapItem({ extents: ext(a), elevation: 0, cursor: { x: 1000, y: 300 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    const others: SnapObstacle[] = [{ id: 'a', placement: first.placement, extents: ext(a) }];
    const res = snapItem({ extents: ext(a), elevation: 0, cursor: { x: 920, y: 300 }, rotation: 0, faces: faces(r), others, settings: { ...DEFAULT_SNAP, items: false } });
    const xs = [0, 600].map((x) => localToWorld2(res.placement, { x, y: 580 }).x);
    expect(Math.max(...xs)).toBeCloseTo(700, 6);
    expect(res.colliding).toBe(false);
  });

  it('wall cabinets do not collide with base cabinets below', () => {
    const r = room();
    const a = base(600);
    const first = snapItem({ extents: ext(a), elevation: 0, cursor: { x: 1000, y: 300 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    const wall = cabinetFromTemplate(templateById('wall-1-door')!, 'C2');
    const res = snapItem({
      extents: itemExtents(wall, 18),
      elevation: 1350,
      cursor: { x: 1000, y: 150 },
      rotation: 0,
      faces: faces(r),
      others: [{ id: 'a', placement: first.placement, extents: ext(a) }],
      settings: { ...DEFAULT_SNAP, items: false },
    });
    const xs = [0, 450].map((x) => localToWorld2(res.placement, { x, y: 300 }).x);
    // Stays over the base cabinet (within the 10 mm grid), not pushed aside.
    expect(Math.abs((xs[0] + xs[1]) / 2 - 1000)).toBeLessThanOrEqual(10);
  });

  it('clamps to the wall corner', () => {
    const r = room();
    const c = base(600);
    const res = snapItem({ extents: ext(c), elevation: 0, cursor: { x: 3950, y: 300 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    const xs = [0, 600].map((x) => localToWorld2(res.placement, { x, y: 580 }).x);
    expect(Math.max(...xs)).toBeCloseTo(4000, 6);
  });

  it('places freely (grid-snapped) in the middle of the room', () => {
    const r = room();
    const c = base(600);
    const res = snapItem({ extents: ext(c), elevation: 0, cursor: { x: 2003, y: 1504 }, rotation: 0, faces: faces(r), others: [], settings: DEFAULT_SNAP });
    expect(res.wallId).toBeNull();
    expect(res.placement.x % 10).toBeCloseTo(0, 6);
  });

  it('snaps openings along the wall and wall points to 15° steps', () => {
    const r = room();
    const s = snapOpening({ x: 2000, y: 30 }, 1200, r.walls, 10);
    expect(s?.wallId).toBe(r.walls[0].id);
    expect(s?.offset).toBe(1450);
    const p = snapWallPoint({ x: 1000, y: 40 }, { x: 0, y: 0 }, [], 10);
    expect(p.point.y).toBeCloseTo(0, 6);
    expect(p.point.x).toBe(1000);
  });
});

describe('automatic ends and benchtops', () => {
  function kitchen(): Room {
    const r = room();
    const f = allFaces(computeWalls(r.walls));
    const items: CabinetItem[] = [];
    for (const [i, cx] of [1000, 1600].entries()) {
      const c = cabinetFromTemplate(templateById('base-1-door')!, `C${i + 1}`);
      c.params.width = 600;
      const res = snapItem({
        extents: itemExtents(c, 18),
        elevation: 0,
        cursor: { x: cx, y: 300 },
        rotation: 0,
        faces: f,
        others: items.map((o) => ({ id: o.id, placement: o.placement, extents: itemExtents(o, 18) })),
        settings: DEFAULT_SNAP,
      });
      items.push({ ...c, placement: res.placement, wallId: res.wallId });
    }
    return { ...r, items };
  }

  it('ends touching another cabinet are unfinished, exposed ends finished', () => {
    const r = kitchen();
    const ends = resolveEnds(r, computeWalls(r.walls));
    const [a, b] = r.items;
    const ea = ends.get(a.id)!;
    const eb = ends.get(b.id)!;
    // Exactly one inner contact on each cabinet; the two outer ends are exposed.
    expect([ea.left, ea.right].filter(Boolean)).toHaveLength(1);
    expect([eb.left, eb.right].filter(Boolean)).toHaveLength(1);
    expect(ea.leftCovered || ea.rightCovered).toBe(true);
  });

  it('ends against a wall are unfinished', () => {
    const r = room();
    const f = allFaces(computeWalls(r.walls));
    const c = cabinetFromTemplate(templateById('base-1-door')!, 'C1');
    const res = snapItem({ extents: itemExtents(c, 18), elevation: 0, cursor: { x: 3900, y: 300 }, rotation: 0, faces: f, others: [], settings: DEFAULT_SNAP });
    const rr = { ...r, items: [{ ...c, placement: res.placement, wallId: res.wallId }] };
    const e = resolveEnds(rr, computeWalls(rr.walls)).get(c.id)!;
    expect([e.leftCovered, e.rightCovered].filter(Boolean)).toHaveLength(1);
  });

  it('one benchtop per run with overhangs only at exposed ends, plus a splashback', () => {
    const r = kitchen();
    const ends = resolveEnds(r, computeWalls(r.walls));
    let n = 0;
    const tops = autoTops(r, ends, DEFAULT_AUTO_TOPS, (p) => `${p}${++n}`);
    const bt = tops.filter((t) => t.panelType === 'benchtop');
    const sb = tops.filter((t) => t.panelType === 'splashback');
    expect(bt).toHaveLength(1);
    expect(bt[0].width).toBeCloseTo(1200 + 2 * 20, 6);
    expect(bt[0].depth).toBeCloseTo(580 + 18 + 22, 6);
    expect(bt[0].placement.elevation).toBe(870);
    expect(sb).toHaveLength(1);
    expect(sb[0].width).toBeCloseTo(1200, 6);
    expect(sb[0].placement.elevation).toBe(890);
  });
});

describe('clash detection', () => {
  const sq = (x: number, y: number, s: number) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  it('touching footprints do not clash, overlapping ones do', () => {
    expect(convexOverlap(sq(0, 0, 100), sq(100, 0, 100))).toBe(false);
    expect(convexOverlap(sq(0, 0, 100), sq(99, 0, 100))).toBe(true);
    expect(convexOverlap(sq(0, 0, 100), sq(99.8, 0, 100))).toBe(false);
  });

  it('finds cabinets that interpenetrate, ignoring ones stacked above', () => {
    const r = room();
    const mk = (id: string, x: number, t = 'base-1-door') => {
      const c = cabinetFromTemplate(templateById(t)!, id);
      c.params.width = 600;
      return { ...c, id, placement: { ...c.placement, x, y: 1000 } };
    };
    const a = mk('a', 0);
    const b = mk('b', 500);
    const c = mk('c', 1100);
    const w = mk('w', 0, 'wall-1-door');
    const rr = { ...r, items: [a, b, c, w] };
    const ext = (i: CabinetItem) => itemExtents(i, 18);
    expect(clashesWith(rr, 'a', ext as never).map((i) => i.id)).toEqual(['b']);
    expect(clashesWith(rr, 'c', ext as never)).toEqual([]);
  });
});
