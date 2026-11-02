import { describe, expect, it } from 'vitest';
import { addItem, allFaces, cabinetFromTemplate, computeWalls, createProject, activeRoom, Deriver, drawingSheets, itemExtents, sheetsToHtml, snapItem, DEFAULT_SNAP, templateById, type ProjectDocument } from '@engine/index';

function project(): ProjectDocument {
  let doc = createProject({ name: 'Smith kitchen', roomWidth: 4000, roomDepth: 3000 });
  const place = (tid: string, cursor: { x: number; y: number }) => {
    const room = activeRoom(doc);
    const c = cabinetFromTemplate(templateById(tid)!, `C${room.items.length + 1}`);
    const res = snapItem({ extents: itemExtents(c, 18), elevation: c.placement.elevation, cursor, rotation: 0, faces: allFaces(computeWalls(room.walls)), others: room.items.map((o) => ({ id: o.id, placement: o.placement, extents: itemExtents(o, 18) })), settings: DEFAULT_SNAP });
    doc = addItem(doc, { ...c, placement: res.placement, wallId: res.wallId });
  };
  place('base-2-door', { x: 1000, y: 300 });
  place('base-3-drawer', { x: 1800, y: 300 });
  place('wall-2-door', { x: 1000, y: 150 });
  return doc;
}

describe('drawing sheets', () => {
  it('produces a plan and one elevation per wall with cabinets', () => {
    const doc = project();
    const d = new Deriver().derive(doc);
    const sheets = drawingSheets(doc, d, () => 'A');
    expect(sheets.map((s) => s.title)).toEqual(['Plan — Kitchen', 'Elevation — wall A']);
    const plan = sheets[0].svg;
    expect(plan).toContain('>4000<');
    expect(plan).toContain('>3000<');
    expect(plan).toContain('>C1<');
    const elev = sheets[1].svg;
    // Cabinet widths, the overall wall length and the standard heights are dimensioned.
    for (const t of ['>900<', '>600<', '>4000<', '>870<', '>750<', '>C3<', 'Smith kitchen', 'Sheet', '1:']) expect(elev).toContain(t);
    expect(elev.match(/class="cs-front"/g)!.length).toBeGreaterThanOrEqual(2 + 3 + 2);
    const html = sheetsToHtml(sheets, 'x');
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
  });
});
