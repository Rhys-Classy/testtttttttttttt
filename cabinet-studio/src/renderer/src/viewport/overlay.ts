// Screen-space overlay: live dimensions, wall clearances, snap guides, the wall-drawing
// preview and the tape measure. Drawn in SVG over the GPU canvas and re-projected after
// every rendered frame, so it stays locked to the 3D model in every view.

import { activeRoom, distance, localToWorld3, type DerivedRoom, type Item, type ProjectDocument, type Vec2 } from '@engine/index';
import type { State } from '../state/store';
import type { RenderEngine } from './RenderEngine';

type P3 = { x: number; y: number; z: number };

interface DimSpec {
  a: P3;
  b: P3;
  /** Offset direction (unit, world mm). */
  dir: P3;
  offsetPx: number;
  label: string;
  tone: 'dim' | 'clear' | 'wall';
}

interface LineSpec {
  a: P3;
  b: P3;
  tone: 'guide' | 'preview' | 'measure' | 'contact';
  label?: string;
}

export interface OverlayData {
  dims: DimSpec[];
  lines: LineSpec[];
  points: { p: P3; tone: 'node' | 'cursor' }[];
}

const fmt = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

function itemSize(i: Item): { w: number; d: number; h: number; y0: number } {
  if (i.kind === 'cabinet') return { w: i.params.width, d: i.params.depth, h: i.params.height, y0: 0 };
  return { w: i.width, d: i.depth, h: i.height, y0: 0 };
}

export function computeOverlay(s: State, d: DerivedRoom, doc: ProjectDocument): OverlayData {
  const dims: DimSpec[] = [];
  const lines: LineSpec[] = [];
  const points: OverlayData['points'] = [];
  const view = s.view;
  const showDims = s.layers.dimensions && view !== 'walk';
  const room = activeRoom(doc);

  if (showDims && view === 'plan') {
    const faces = d.interiorFaceIds.size ? d.faces.filter((f) => d.interiorFaceIds.has(f.id)) : [];
    for (const f of faces) dims.push({ a: { ...f.a, z: 0 }, b: { ...f.b, z: 0 }, dir: { ...f.normal, z: 0 }, offsetPx: 22, label: fmt(f.length), tone: 'wall' });
    if (!faces.length) {
      for (const w of room.walls) {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const l = Math.hypot(dx, dy) || 1;
        dims.push({ a: { ...w.start, z: 0 }, b: { ...w.end, z: 0 }, dir: { x: -dy / l, y: dx / l, z: 0 }, offsetPx: 22, label: fmt(l), tone: 'wall' });
      }
    }
  }

  const sel = s.selection;
  if (showDims && sel?.kind === 'item') {
    const item = room.items.find((i) => i.id === sel.id);
    const build = item && d.builds.get(item.id);
    if (item && build) {
      const b = build.bounds;
      const { w, h } = itemSize(item);
      const pl = item.placement;
      const L = (x: number, y: number, z: number) => localToWorld3(pl, { x, y, z });
      const xAxis = { x: Math.cos(pl.rotation), y: Math.sin(pl.rotation), z: 0 };
      const front = { x: Math.sin(pl.rotation), y: -Math.cos(pl.rotation), z: 0 };
      const neg = (v: P3) => ({ x: -v.x, y: -v.y, z: -v.z });
      const up = { x: 0, y: 0, z: 1 };
      const depthLabel = item.kind === 'cabinet' ? fmt(item.params.depth) : fmt(item.depth);
      if (view === 'plan') {
        dims.push({ a: L(0, b.y, h), b: L(w, b.y, h), dir: front, offsetPx: 26, label: fmt(w), tone: 'dim' });
        dims.push({ a: L(0, 0, h), b: L(0, b.y + b.sy, h), dir: neg(xAxis), offsetPx: 26, label: depthLabel, tone: 'dim' });
      } else if (view === 'side') {
        dims.push({ a: L(0, 0, 0), b: L(0, 0, h), dir: front, offsetPx: 30, label: fmt(h), tone: 'dim' });
        dims.push({ a: L(0, 0, h), b: L(0, b.y + b.sy, h), dir: up, offsetPx: 22, label: depthLabel, tone: 'dim' });
      } else {
        const onFloor = pl.elevation < 1;
        dims.push({ a: L(0, b.y, onFloor ? h : 0), b: L(w, b.y, onFloor ? h : 0), dir: onFloor ? up : neg(up), offsetPx: 24, label: fmt(w), tone: 'dim' });
        dims.push({ a: L(0, b.y, 0), b: L(0, b.y, h), dir: neg(xAxis), offsetPx: 26, label: fmt(h), tone: 'dim' });
        if (view === '3d') dims.push({ a: L(w, b.y, onFloor ? h : 0), b: L(w, b.y + b.sy, onFloor ? h : 0), dir: xAxis, offsetPx: 22, label: depthLabel, tone: 'dim' });
        if (view === 'front' && pl.elevation > 1) dims.push({ a: L(w, b.y, -pl.elevation), b: L(w, b.y, 0), dir: xAxis, offsetPx: 26, label: fmt(pl.elevation), tone: 'clear' });
      }
      // Clearances to the ends of the wall the item is against.
      if ((view === 'plan' || view === 'front') && item.wallId) {
        const backL = L(0, b.y + b.sy, 0);
        const face = d.faces.find((f) => {
          if (f.wallId !== item.wallId) return false;
          const n = f.normal;
          return Math.abs((backL.x - f.a.x) * n.x + (backL.y - f.a.y) * n.y) < 2;
        });
        if (face) {
          const ax = { x: -face.normal.y, y: face.normal.x };
          const u = (p: Vec2) => (p.x - face.a.x) * ax.x + (p.y - face.a.y) * ax.y;
          const ub = u(face.b);
          const u0 = Math.min(0, ub);
          const u1 = Math.max(0, ub);
          const iu0 = u(backL);
          const iu1 = iu0 + w;
          const at = (uu: number, z: number): P3 => ({ x: face.a.x + ax.x * uu, y: face.a.y + ax.y * uu, z });
          const z = view === 'plan' ? 0 : pl.elevation + h;
          const dir = view === 'plan' ? { ...face.normal, z: 0 } : up;
          const off = view === 'plan' ? 48 : 30;
          if (iu0 - u0 > 1) dims.push({ a: at(u0, z), b: at(iu0, z), dir, offsetPx: off, label: fmt(iu0 - u0), tone: 'clear' });
          if (u1 - iu1 > 1) dims.push({ a: at(iu1, z), b: at(u1, z), dir, offsetPx: off, label: fmt(u1 - iu1), tone: 'clear' });
        }
      }
    }
  }
  if (showDims && sel?.kind === 'wall') {
    const w = room.walls.find((x) => x.id === sel.id);
    if (w) {
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const l = Math.hypot(dx, dy) || 1;
      dims.push({ a: { ...w.start, z: w.height }, b: { ...w.end, z: w.height }, dir: { x: -dy / l, y: dx / l, z: 0 }, offsetPx: 30, label: fmt(l), tone: 'dim' });
    }
  }
  if (showDims && sel?.kind === 'opening') {
    const o = room.openings.find((x) => x.id === sel.id);
    const g = o && d.walls.get(o.wallId);
    if (o && g) {
      const p = (u: number, z: number): P3 => ({ x: g.wall.start.x + g.dir.x * u, y: g.wall.start.y + g.dir.y * u, z });
      const n = { x: -g.dir.y, y: g.dir.x, z: 0 };
      dims.push({ a: p(o.offset, o.sill + o.height), b: p(o.offset + o.width, o.sill + o.height), dir: view === 'plan' ? n : { x: 0, y: 0, z: 1 }, offsetPx: 22, label: fmt(o.width), tone: 'dim' });
      if (o.offset > 1) dims.push({ a: p(0, 0), b: p(o.offset, 0), dir: view === 'plan' ? n : { x: 0, y: 0, z: -1 }, offsetPx: 40, label: fmt(o.offset), tone: 'clear' });
    }
  }

  for (const g of s.guides) lines.push({ a: { ...g.a, z: 0 }, b: { ...g.b, z: 0 }, tone: g.kind === 'face' ? 'guide' : 'contact' });

  if (s.tool === 'wall') {
    const pts = s.drawing.points;
    for (const p of pts) points.push({ p: { ...p, z: 0 }, tone: 'node' });
    const last = pts[pts.length - 1];
    if (last && s.drawing.cursor) {
      const len = distance(last, s.drawing.cursor);
      lines.push({ a: { ...last, z: 0 }, b: { ...s.drawing.cursor, z: 0 }, tone: 'preview', label: s.drawing.typed ? `${s.drawing.typed} ↵` : fmt(len) });
    }
    if (s.drawing.cursor) points.push({ p: { ...s.drawing.cursor, z: 0 }, tone: 'cursor' });
  }
  if (s.tool === 'measure') {
    const m = s.measure;
    const end = m.b ?? m.cursor;
    if (m.a && end) lines.push({ a: { ...m.a, z: 0 }, b: { ...end, z: 0 }, tone: 'measure', label: fmt(distance(m.a, end)) });
    if (m.a) points.push({ p: { ...m.a, z: 0 }, tone: 'node' });
    if (m.cursor && !m.b) points.push({ p: { ...m.cursor, z: 0 }, tone: 'cursor' });
  }
  return { dims, lines, points };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function label(x: number, y: number, angle: number, text: string, cls: string): string {
  let a = angle;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  const w = text.length * 6.6 + 10;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(1)})" class="${cls}"><rect x="${-w / 2}" y="-8.5" width="${w}" height="17" rx="4"/><text y="4">${esc(text)}</text></g>`;
}

export function renderOverlay(svg: SVGSVGElement, engine: RenderEngine, data: OverlayData): void {
  const parts: string[] = [];
  for (const dm of data.dims) {
    const mid = { x: (dm.a.x + dm.b.x) / 2, y: (dm.a.y + dm.b.y) / 2, z: (dm.a.z + dm.b.z) / 2 };
    const k = engine.mmPerPixel(mid) * dm.offsetPx;
    const off = (p: P3) => ({ x: p.x + dm.dir.x * k, y: p.y + dm.dir.y * k, z: p.z + dm.dir.z * k });
    const pa = engine.project(dm.a);
    const pb = engine.project(dm.b);
    const qa = engine.project(off(dm.a));
    const qb = engine.project(off(dm.b));
    if (!pa || !pb || !qa || !qb) continue;
    const len = Math.hypot(qb.x - qa.x, qb.y - qa.y);
    if (len < 14) continue;
    const ang = (Math.atan2(qb.y - qa.y, qb.x - qa.x) * 180) / Math.PI;
    const ux = (qb.x - qa.x) / len;
    const uy = (qb.y - qa.y) / len;
    const tick = (q: { x: number; y: number }) => `M${q.x - (ux + uy) * 4} ${q.y - (uy - ux) * 4}L${q.x + (ux + uy) * 4} ${q.y + (uy - ux) * 4}`;
    const ext = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const el = Math.hypot(ex, ey) || 1;
      return `M${p.x + (ex / el) * 3} ${p.y + (ey / el) * 3}L${q.x + (ex / el) * 4} ${q.y + (ey / el) * 4}`;
    };
    parts.push(
      `<path class="dim-ext ${dm.tone}" d="${ext(pa, qa)}${ext(pb, qb)}"/>`,
      `<path class="dim-line ${dm.tone}" d="M${qa.x} ${qa.y}L${qb.x} ${qb.y}${tick(qa)}${tick(qb)}"/>`,
      label((qa.x + qb.x) / 2, (qa.y + qb.y) / 2, ang, dm.label, `dim-label ${dm.tone}`),
    );
  }
  for (const l of data.lines) {
    const a = engine.project(l.a);
    const b = engine.project(l.b);
    if (!a || !b) continue;
    parts.push(`<path class="ov-line ${l.tone}" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`);
    if (l.label) {
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      parts.push(label((a.x + b.x) / 2, (a.y + b.y) / 2 - 14, ang, l.label, `dim-label ${l.tone}`));
    }
  }
  for (const pt of data.points) {
    const p = engine.project(pt.p);
    if (!p) continue;
    parts.push(pt.tone === 'cursor' ? `<path class="ov-cursor" d="M${p.x - 7} ${p.y}h14M${p.x} ${p.y - 7}v14"/>` : `<circle class="ov-node" cx="${p.x}" cy="${p.y}" r="4"/>`);
  }
  svg.innerHTML = parts.join('');
}
