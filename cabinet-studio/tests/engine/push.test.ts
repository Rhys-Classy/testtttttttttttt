import { describe, expect, it } from 'vitest';
import {
  activeRoom,
  addItem,
  addOpening,
  cabinetFromTemplate,
  createProject,
  findItem,
  pushItem,
  templateById,
  worldFootprint,
  Deriver,
  type CabinetItem,
  type ProjectDocument,
} from '@engine/index';

const project = () => createProject({ roomWidth: 4000, roomDepth: 3000, wallThickness: 100 });

function place(doc: ProjectDocument, template: string, label: string, x: number, y: number, rotation = 0): { doc: ProjectDocument; item: CabinetItem } {
  const base = cabinetFromTemplate(templateById(template)!, label);
  const item: CabinetItem = { ...base, placement: { ...base.placement, x, y, rotation } };
  return { doc: addItem(doc, item), item };
}

const extentsOf = (doc: ProjectDocument, id: string) => {
  const it = findItem(doc, id)!;
  const pts = worldFootprint(it.placement, new Deriver().extents(doc, it));
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
};

describe('pushItem', () => {
  it('closes a 300 mm gap between two base cabinets', () => {
    let d = project();
    const a = place(d, 'base-2-door', 'A', 1000, 1000);
    const b = place(a.doc, 'base-2-door', 'B', 1000 + 900 + 300, 1000);
    const r = pushItem(b.doc, a.item.id, 'right')!;
    expect(r.distance).toBeCloseTo(300, 6);
    expect(findItem(r.doc, a.item.id)!.placement.x).toBeCloseTo(1300, 6);
    expect(findItem(b.doc, a.item.id)!.placement.x).toBe(1000); // input untouched
    d = r.doc;
  });

  it('pushes left flush with the side wall inner face, honouring gap', () => {
    const a = place(project(), 'base-2-door', 'A', 1500, 1000);
    const r = pushItem(a.doc, a.item.id, 'left')!;
    expect(r.distance).toBeCloseTo(1500, 6);
    expect(extentsOf(r.doc, a.item.id).minX).toBeCloseTo(0, 6);
    expect(pushItem(a.doc, a.item.id, 'left', 10)!.distance).toBeCloseTo(1490, 6);
  });

  it('returns null with nothing in that direction', () => {
    const doc = project();
    const room = activeRoom(doc);
    const open = { ...doc, rooms: [{ ...room, walls: [] }] };
    const a = place(open, 'base-2-door', 'A', 1000, 1000);
    expect(pushItem(a.doc, a.item.id, 'right')).toBeNull();
    expect(pushItem(a.doc, a.item.id, 'left')).toBeNull();
  });

  it('wall cabinet stops at a window clearance zone; base cabinet passes below the sill', () => {
    let doc = project();
    const wallId = activeRoom(doc).walls[2].id; // north wall, runs from x=4050 towards x=-50
    doc = addOpening(doc, { wallId, kind: 'window', offset: 1000, width: 1000, sill: 1000, height: 1000 }).doc;
    const wallT = templateById('wall-1-door')!;
    const baseT = templateById('base-1-door')!;
    const w = place(doc, 'wall-1-door', 'W', 500, 3000 - wallT.params.depth);
    const b = place(w.doc, 'base-1-door', 'B', 500, 3000 - baseT.params.depth);
    const rw = pushItem(b.doc, w.item.id, 'right')!;
    expect(extentsOf(rw.doc, w.item.id).maxX).toBeCloseTo(2050, 6);
    const rb = pushItem(b.doc, b.item.id, 'right')!;
    expect(extentsOf(rb.doc, b.item.id).maxX).toBeCloseTo(4000, 6);
  });

  it('already touching: distance 0 and same doc reference', () => {
    const a = place(project(), 'base-2-door', 'A', 0, 1000);
    const r = pushItem(a.doc, a.item.id, 'left')!;
    expect(r.distance).toBe(0);
    expect(r.doc).toBe(a.doc);
  });

  it('pushes along its own axis when rotated 90 degrees', () => {
    const a = place(project(), 'base-2-door', 'A', 1000, 500, Math.PI / 2);
    const r = pushItem(a.doc, a.item.id, 'right')!;
    const e = extentsOf(r.doc, a.item.id);
    expect(e.maxY).toBeCloseTo(3000, 6);
    expect(findItem(r.doc, a.item.id)!.placement.x).toBeCloseTo(1000, 6);
  });

  it('stops a base cabinet at an L corner cabinet footprint', () => {
    const a = place(project(), 'base-1-door', 'A', 100, 0);
    const c = place(a.doc, 'base-corner-l', 'K', 1500, 0);
    const r = pushItem(c.doc, a.item.id, 'right')!;
    expect(extentsOf(r.doc, a.item.id).maxX).toBeCloseTo(1500, 6);
  });
});
