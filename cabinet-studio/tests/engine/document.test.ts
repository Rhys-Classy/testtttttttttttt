import { describe, expect, it } from 'vitest';
import {
  activeRoom,
  addItem,
  buildCutlist,
  buildHardwareSchedule,
  cabinetFromTemplate,
  createProject,
  cutlistToCsv,
  Deriver,
  duplicateItems,
  mirrorItem,
  parseProject,
  ProjectFileError,
  removeItems,
  rotateItem,
  serializeProject,
  templateById,
  updateCabinetParams,
  type CabinetItem,
} from '@engine/index';

function projectWith(...templateIds: string[]) {
  let doc = createProject();
  templateIds.forEach((id, i) => {
    const c = cabinetFromTemplate(templateById(id)!, `C${i + 1}`);
    c.placement = { x: 400 + i * 1000, y: 1500, rotation: 0, elevation: c.placement.elevation };
    doc = addItem(doc, c);
  });
  return doc;
}

describe('cutlist', () => {
  it('groups parts by material and thickness and aggregates identical parts', () => {
    const doc = projectWith('base-2-door', 'base-2-door');
    const d = new Deriver().derive(doc);
    const groups = buildCutlist(d.builds.values(), d.materials);
    const names = groups.map((g) => `${g.thickness} ${g.materialName}`);
    expect(names).toContain('18 Polar White Matt');
    expect(names).toContain('16 Carcass White');
    const fronts = groups.find((g) => g.materialName === 'Polar White Matt' && g.thickness === 18)!;
    const doorRows = fronts.rows.filter((r) => r.name.startsWith('Door'));
    expect(doorRows.reduce((a, r) => a + r.quantity, 0)).toBe(4);
    expect(doorRows[0]).toMatchObject({ cutLength: 716.5, cutWidth: 445, banding: '1,1,1,1' });
    // Free-standing cabinets: all four ends exposed → finished in the front material at 16 mm.
    const ends = groups.find((g) => g.materialName === 'Polar White Matt' && g.thickness === 16)!;
    expect(ends.rows.reduce((a, r) => a + r.quantity, 0)).toBe(4 + 2);
    const total = groups.reduce((a, g) => a + g.partCount, 0);
    expect(total).toBe([...d.builds.values()].reduce((a, b) => a + b.parts.length, 0));
    expect(cutlistToCsv(groups).split('\r\n')[0]).toMatch(/^Material,Thickness/);
  });

  it('hardware schedule totals hinges across cabinets', () => {
    const doc = projectWith('base-2-door', 'wall-2-door');
    const d = new Deriver().derive(doc);
    const hw = buildHardwareSchedule(d.builds.values());
    const hinges = hw.find((h) => h.hardwareId === 'hinge-110-softclose')!;
    expect(hinges.quantity).toBe(8);
    expect(hinges.items).toBe('C1 (4), C2 (4)');
  });
});

describe('document commands', () => {
  it('editing a parameter rebuilds only that cabinet', () => {
    const doc = projectWith('base-2-door', 'wall-2-door');
    const deriver = new Deriver();
    const before = deriver.derive(doc);
    const [a, b] = activeRoom(doc).items;
    const next = updateCabinetParams(doc, a.id, { width: 1000 });
    const after = deriver.derive(next);
    expect(after.builds.get(b.id)).toBe(before.builds.get(b.id));
    expect(after.builds.get(a.id)).not.toBe(before.builds.get(a.id));
    expect(activeRoom(doc).items[0]).toBe(a); // original document untouched
  });

  it('duplicate places the copy beside the original with a new label', () => {
    const doc = projectWith('base-1-door');
    const [a] = activeRoom(doc).items as CabinetItem[];
    const { doc: d2, newIds } = duplicateItems(doc, [a.id]);
    const copy = activeRoom(d2).items.find((i) => i.id === newIds[0]) as CabinetItem;
    expect(copy.label).not.toBe(a.label);
    expect(copy.placement.x).toBeCloseTo(a.placement.x + a.params.width, 6);
    expect(copy.params.fronts[0].id).not.toBe(a.params.fronts[0].id);
  });

  it('mirror swaps handing; rotate keeps the footprint centre', () => {
    const doc = projectWith('base-blind-corner');
    const [a] = activeRoom(doc).items as CabinetItem[];
    const m = activeRoom(mirrorItem(doc, a.id)).items[0] as CabinetItem;
    expect(m.params.blind?.side).toBe('right');
    expect(m.params.hingeSide).toBe('left');
    const r = activeRoom(rotateItem(doc, a.id, Math.PI / 2)).items[0] as CabinetItem;
    const cx = (p: CabinetItem) => p.placement.x + Math.cos(p.placement.rotation) * 500 - Math.sin(p.placement.rotation) * 290;
    expect(cx(r)).toBeCloseTo(cx(a), 6);
    expect(activeRoom(removeItems(doc, [a.id])).items).toHaveLength(0);
  });
});

describe('project files', () => {
  it('round-trips a project exactly', () => {
    const doc = projectWith('base-3-drawer', 'tall-oven');
    const { doc: back, warnings } = parseProject(serializeProject(doc));
    expect(warnings).toEqual([]);
    expect(back).toEqual(doc);
  });

  it('refuses files that are not projects or come from a newer version', () => {
    expect(() => parseProject('nope')).toThrow(ProjectFileError);
    expect(() => parseProject(JSON.stringify({ format: 'other' }))).toThrow(/not a Cabinet Studio project/);
    const future = JSON.parse(serializeProject(createProject()));
    future.schemaVersion = 99;
    expect(() => parseProject(JSON.stringify(future))).toThrow(/newer version/);
  });
});

describe('performance', () => {
  it('builds 400 cabinets (thousands of parts) quickly and incrementally', () => {
    let doc = createProject();
    const ids = ['base-2-door', 'base-3-drawer', 'wall-2-door', 'tall-oven'];
    for (let i = 0; i < 400; i++) {
      const c = cabinetFromTemplate(templateById(ids[i % ids.length])!, `C${i + 1}`);
      c.placement = { x: (i % 20) * 1000, y: Math.floor(i / 20) * 1500, rotation: 0, elevation: c.placement.elevation };
      doc = addItem(doc, c);
    }
    const deriver = new Deriver();
    const t0 = performance.now();
    const d = deriver.derive(doc);
    const t1 = performance.now();
    const parts = [...d.builds.values()].reduce((a, b) => a + b.parts.length, 0);
    expect(parts).toBeGreaterThan(5000);
    const first = activeRoom(doc).items[0];
    const doc2 = updateCabinetParams(doc, first.id, { width: 700 });
    const t2 = performance.now();
    deriver.derive(doc2);
    const t3 = performance.now();
    expect(t1 - t0).toBeLessThan(1500);
    expect(t3 - t2).toBeLessThan(t1 - t0);
  });
});
