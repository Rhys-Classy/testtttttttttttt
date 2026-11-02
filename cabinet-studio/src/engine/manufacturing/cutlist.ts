// Cutlists and hardware schedules straight from the construction engine's parts.
// No re-measuring and no approximation: each row is a set of identical parts.

import { bandedEdgeCount, bandedLength, bandingLabel, type HardwarePlacement, type ItemBuild, type Part } from '../construction/parts';
import type { Id, MaterialDef } from '../model/types';

export interface CutlistRow {
  quantity: number;
  name: string;
  role: Part['role'];
  cutLength: number;
  cutWidth: number;
  length: number;
  width: number;
  thickness: number;
  banding: string;
  bandedEdges: number;
  grain: boolean;
  /** Non-rectangular part: sizes are the bounding blank, the outline is cut by CNC. */
  shaped: boolean;
  /** Item labels with counts, e.g. "C1, C3 (2)". */
  items: string;
  comment: string;
}

export interface CutlistGroup {
  key: string;
  materialId: Id;
  materialName: string;
  thickness: number;
  rows: CutlistRow[];
  partCount: number;
  /** Total cut area, m². */
  area: number;
  /** Total banded edge length, m. */
  bandingLength: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function itemSummary(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([l, c]) => (c > 1 ? `${l} (${c})` : l))
    .join(', ');
}

export function buildCutlist(builds: Iterable<ItemBuild>, materials: ReadonlyMap<Id, MaterialDef>): CutlistGroup[] {
  const groups = new Map<string, { materialId: Id; thickness: number; parts: Part[] }>();
  for (const b of builds) {
    for (const p of b.parts) {
      const key = `${p.materialId}|${r1(p.thickness)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { materialId: p.materialId, thickness: r1(p.thickness), parts: [] }));
      g.parts.push(p);
    }
  }
  const out: CutlistGroup[] = [];
  for (const [key, g] of groups) {
    const m = materials.get(g.materialId);
    const rows = new Map<string, { row: CutlistRow; labels: string[] }>();
    let area = 0;
    let banding = 0;
    for (const p of g.parts) {
      const code = bandingLabel(p);
      const rk = [p.name, r1(p.cutLength), r1(p.cutWidth), code, p.comment ?? ''].join('|');
      let entry = rows.get(rk);
      if (!entry) {
        entry = {
          row: {
            quantity: 0,
            name: p.name,
            role: p.role,
            cutLength: r1(p.cutLength),
            cutWidth: r1(p.cutWidth),
            length: r1(p.length),
            width: r1(p.width),
            thickness: r1(p.thickness),
            banding: code,
            bandedEdges: p.profile ? (p.profile.edgeBanding ?? []).filter((b) => b > 0).length : bandedEdgeCount(p.banding),
            grain: !!m?.grain,
            shaped: !!p.profile,
            items: '',
            comment: p.comment ?? '',
          },
          labels: [],
        };
        rows.set(rk, entry);
      }
      entry.row.quantity++;
      entry.labels.push(p.itemLabel);
      area += (p.cutLength * p.cutWidth) / 1e6;
      banding += bandedLength(p) / 1000;
    }
    const list = [...rows.values()].map((e) => ({ ...e.row, items: itemSummary(e.labels) }));
    list.sort((a, b) => b.cutLength * b.cutWidth - a.cutLength * a.cutWidth || a.name.localeCompare(b.name));
    out.push({
      key,
      materialId: g.materialId,
      materialName: m?.name ?? g.materialId,
      thickness: g.thickness,
      rows: list,
      partCount: g.parts.length,
      area: Math.round(area * 1000) / 1000,
      bandingLength: Math.round(banding * 100) / 100,
    });
  }
  out.sort((a, b) => b.thickness - a.thickness || a.materialName.localeCompare(b.materialName));
  return out;
}

export interface HardwareRow {
  hardwareId: string;
  name: string;
  detail: string;
  quantity: number;
  items: string;
}

export function buildHardwareSchedule(builds: Iterable<ItemBuild>): HardwareRow[] {
  const rows = new Map<string, { row: HardwareRow; perItem: Map<string, number> }>();
  for (const b of builds) {
    for (const h of b.hardware as HardwarePlacement[]) {
      const detail = h.type === 'hinge' ? '' : (h.detail ?? '');
      const key = `${h.hardwareId}|${detail}`;
      let e = rows.get(key);
      if (!e) rows.set(key, (e = { row: { hardwareId: h.hardwareId, name: h.name, detail, quantity: 0, items: '' }, perItem: new Map() }));
      e.row.quantity += h.qty;
      e.perItem.set(h.itemLabel, (e.perItem.get(h.itemLabel) ?? 0) + h.qty);
    }
  }
  const summary = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([l, q]) => `${l} (${q})`)
      .join(', ');
  return [...rows.values()]
    .map((e) => ({ ...e.row, items: summary(e.perItem) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.detail.localeCompare(b.detail));
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function cutlistToCsv(groups: CutlistGroup[]): string {
  const header = ['Material', 'Thickness (mm)', 'Qty', 'Cut length (mm)', 'Cut width (mm)', 'Finished length (mm)', 'Finished width (mm)', 'Part', 'Edge banding L1,L2,W1,W2 (mm)', 'Grain', 'Shape', 'Items', 'Comment'];
  const lines = [header.map(csvCell).join(',')];
  for (const g of groups) {
    for (const r of g.rows) {
      lines.push(
        [g.materialName, g.thickness, r.quantity, r.cutLength, r.cutWidth, r.length, r.width, r.name, r.banding, r.grain ? 'Along length' : '', r.shaped ? 'Shaped (CNC outline)' : 'Rectangle', r.items, r.comment]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function hardwareToCsv(rows: HardwareRow[]): string {
  const lines = [['Hardware', 'Detail', 'Qty', 'Items'].map(csvCell).join(',')];
  for (const r of rows) lines.push([r.name, r.detail, r.quantity, r.items].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
