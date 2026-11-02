// Dimensioned drawing sheets (A3 landscape SVG): floor plan and one elevation per wall
// that has cabinets. Generated from the same builds as the 3D view and the cutlist, so
// every number on paper is the number the workshop cuts to.

import { angleDiff, dot, sub, type Vec2 } from '../math/vec';
import { boundsOf } from '../math/geometry2d';
import { localToWorld2 } from '../math/placement';
import type { ItemBuild, Part } from '../construction/parts';
import type { DerivedRoom } from '../document/derive';
import { itemExtents, worldFootprint } from '../layout/extents';
import type { Item, ProjectDocument } from '../model/types';
import { wallPieces, type WallFace } from '../room/walls';

const PAGE = { w: 420, h: 297 };
const MARGIN = 10;
const TITLE_H = 26;
const AREA = { x: MARGIN, y: MARGIN, w: PAGE.w - 2 * MARGIN, h: PAGE.h - 2 * MARGIN - TITLE_H - 4 };
const SCALES = [5, 10, 20, 25, 50, 100, 200];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n1 = (v: number) => (Math.round(v * 100) / 100).toString();
const mm = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export interface SheetMeta {
  title: string;
  sheet: number;
  of: number;
}

export interface DrawingSheet {
  title: string;
  svg: string;
}

/** Paper mapping: model (u, v) in mm → paper mm. v is "up" on paper. */
interface Mapper {
  x: (u: number) => number;
  y: (v: number) => number;
  scale: number;
}

function fitMapper(minU: number, minV: number, maxU: number, maxV: number, padMm = 18): Mapper {
  const w = Math.max(1, maxU - minU);
  const h = Math.max(1, maxV - minV);
  const availW = AREA.w - 2 * padMm;
  const availH = AREA.h - 2 * padMm;
  const scale = SCALES.find((s) => w / s <= availW && h / s <= availH) ?? SCALES[SCALES.length - 1];
  const k = 1 / scale;
  const ox = AREA.x + (AREA.w - w * k) / 2 - minU * k;
  const oy = AREA.y + (AREA.h - h * k) / 2 + maxV * k;
  return { x: (u) => ox + u * k, y: (v) => oy - v * k, scale };
}

class Svg {
  private out: string[] = [];
  line(x1: number, y1: number, x2: number, y2: number, cls = 'l'): void {
    this.out.push(`<line class="cs-${cls}" x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}"/>`);
  }
  rect(x: number, y: number, w: number, h: number, cls = 'l'): void {
    this.out.push(`<rect class="cs-${cls}" x="${n1(Math.min(x, x + w))}" y="${n1(Math.min(y, y + h))}" width="${n1(Math.abs(w))}" height="${n1(Math.abs(h))}"/>`);
  }
  poly(pts: { x: number; y: number }[], cls = 'l'): void {
    this.out.push(`<polygon class="cs-${cls}" points="${pts.map((p) => `${n1(p.x)},${n1(p.y)}`).join(' ')}"/>`);
  }
  text(x: number, y: number, s: string, cls = 't', rotate = 0): void {
    const tr = rotate ? ` transform="rotate(${rotate} ${n1(x)} ${n1(y)})"` : '';
    this.out.push(`<text class="cs-${cls}" x="${n1(x)}" y="${n1(y)}"${tr}>${esc(s)}</text>`);
  }
  raw(s: string): void {
    this.out.push(s);
  }
  /** Dimension between paper points, offset perpendicular by `off` paper mm. */
  dim(ax: number, ay: number, bx: number, by: number, off: number, label: string): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const a2 = { x: ax + nx * off, y: ay + ny * off };
    const b2 = { x: bx + nx * off, y: by + ny * off };
    const ext = (p: { x: number; y: number }, q: { x: number; y: number }) => this.line(p.x + nx * Math.sign(off) * 1, p.y + ny * Math.sign(off) * 1, q.x + nx * Math.sign(off) * 1.5, q.y + ny * Math.sign(off) * 1.5, 'dx');
    ext({ x: ax, y: ay }, a2);
    ext({ x: bx, y: by }, b2);
    this.line(a2.x, a2.y, b2.x, b2.y, 'd');
    for (const p of [a2, b2]) this.line(p.x - (ux + nx) * 1.1, p.y - (uy + ny) * 1.1, p.x + (ux + nx) * 1.1, p.y + (uy + ny) * 1.1, 'd');
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    const mx = (a2.x + b2.x) / 2 + nx * Math.sign(off || 1) * 1.6;
    const my = (a2.y + b2.y) / 2 + ny * Math.sign(off || 1) * 1.6;
    this.text(mx, my, label, 'td', ang);
  }
  toString(): string {
    return this.out.join('\n');
  }
}

const STYLE = `<style>
.cs-l{fill:none;stroke:#111;stroke-width:0.3}
.cs-lt{fill:none;stroke:#555;stroke-width:0.18}
.cs-lh{fill:none;stroke:#111;stroke-width:0.45}
.cs-wall{fill:#cfcfcf;stroke:#111;stroke-width:0.35}
.cs-front{fill:#fff;stroke:#111;stroke-width:0.35}
.cs-top{fill:#f1efe9;stroke:#111;stroke-width:0.3}
.cs-dash{fill:none;stroke:#333;stroke-width:0.22;stroke-dasharray:1.6 1.2}
.cs-hinge{fill:none;stroke:#777;stroke-width:0.18;stroke-dasharray:1.2 1}
.cs-app{fill:#e9e9e9;stroke:#111;stroke-width:0.3}
.cs-d{stroke:#1d4ed8;stroke-width:0.18}
.cs-dx{stroke:#1d4ed8;stroke-width:0.12}
.cs-t{font:2.6px Arial,Helvetica,sans-serif;fill:#111;text-anchor:middle;dominant-baseline:middle}
.cs-tl{font:3px Arial,Helvetica,sans-serif;fill:#111;font-weight:bold;text-anchor:middle;dominant-baseline:middle}
.cs-td{font:2.3px Arial,Helvetica,sans-serif;fill:#1d4ed8;text-anchor:middle;dominant-baseline:middle}
.cs-tb{font:3px Arial,Helvetica,sans-serif;fill:#111}
.cs-tbs{font:2.2px Arial,Helvetica,sans-serif;fill:#555}
.cs-tbl{font:5px Arial,Helvetica,sans-serif;fill:#111;font-weight:bold}
.cs-frame{fill:none;stroke:#111;stroke-width:0.5}
</style>`;

function titleBlock(doc: ProjectDocument, meta: SheetMeta, scale: number | null): string {
  const y = PAGE.h - MARGIN - TITLE_H;
  const x = MARGIN;
  const w = PAGE.w - 2 * MARGIN;
  const cols = [0, 150, 245, 320, 360, w];
  const c = doc.client;
  const cell = (i: number, label: string, value: string, big = false) =>
    `<text class="cs-tbs" x="${n1(x + cols[i] + 3)}" y="${n1(y + 6)}">${esc(label)}</text><text class="cs-${big ? 'tbl' : 'tb'}" x="${n1(x + cols[i] + 3)}" y="${n1(y + (big ? 16 : 14))}">${esc(value)}</text>`;
  const lines = cols
    .slice(1, -1)
    .map((cx) => `<line class="cs-l" x1="${n1(x + cx)}" y1="${n1(y)}" x2="${n1(x + cx)}" y2="${n1(y + TITLE_H)}"/>`)
    .join('');
  const date = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  return [
    `<rect class="cs-frame" x="${MARGIN}" y="${MARGIN}" width="${w}" height="${PAGE.h - 2 * MARGIN}"/>`,
    `<line class="cs-frame" x1="${x}" y1="${y}" x2="${x + w}" y2="${y}"/>`,
    lines,
    cell(0, 'Drawing', meta.title, true),
    cell(1, 'Project', doc.name),
    `<text class="cs-tbs" x="${n1(x + cols[1] + 3)}" y="${n1(y + 20)}">${esc([c.name, c.address].filter(Boolean).join(' — '))}</text>`,
    cell(2, 'Scale (A3)', scale ? `1:${scale}` : '—'),
    cell(3, 'Date', date),
    cell(4, 'Sheet', `${meta.sheet} of ${meta.of}`),
    `<text class="cs-tbs" x="${n1(x + cols[2] + 3)}" y="${n1(y + 20)}">All dimensions in mm</text>`,
  ].join('\n');
}

function wrap(doc: ProjectDocument, meta: SheetMeta, body: string, scale: number | null): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}">${STYLE}<rect x="0" y="0" width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>${body}${titleBlock(doc, meta, scale)}</svg>`;
}

const isWallCab = (i: Item) => i.kind === 'cabinet' && i.category === 'wall';

/** Plan outline of an item (L-shape for corner cabinets) in world coordinates. */
function planOutline(i: Item): Vec2[] {
  if (i.kind === 'cabinet' && i.params.corner) {
    const { width: W, depth: D } = i.params;
    const R = i.params.corner.returnWidth;
    const left = i.params.corner.side === 'left';
    const L: Vec2[] = left
      ? [{ x: 0, y: 0 }, { x: D, y: 0 }, { x: D, y: R - D }, { x: W, y: R - D }, { x: W, y: R }, { x: 0, y: R }]
      : [{ x: W - D, y: 0 }, { x: W, y: 0 }, { x: W, y: R }, { x: 0, y: R }, { x: 0, y: R - D }, { x: W - D, y: R - D }];
    return L.map((p) => localToWorld2(i.placement, p));
  }
  return worldFootprint(i.placement, itemExtents(i, 0));
}

export function planSheet(doc: ProjectDocument, d: DerivedRoom, meta: SheetMeta): DrawingSheet {
  const pts: Vec2[] = [];
  for (const g of d.walls.values()) pts.push(...g.outline);
  for (const i of d.room.items) pts.push(...planOutline(i));
  const b = pts.length ? boundsOf(pts) : { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
  const M = fitMapper(b.minX, b.minY, b.maxX, b.maxY, 22);
  const P = (p: Vec2) => ({ x: M.x(p.x), y: M.y(p.y) });
  const s = new Svg();
  // Walls at floor level (door openings show as gaps).
  for (const g of d.walls.values()) {
    for (const piece of wallPieces(g, d.room.openings)) if (piece.z0 === 0) s.poly(piece.polygon.map(P), 'wall');
  }
  // Windows: glazing lines across the opening.
  for (const o of d.room.openings) {
    const g = d.walls.get(o.wallId);
    if (!g) continue;
    const at = (u: number, v: number) => P({ x: g.wall.start.x + g.dir.x * u - g.dir.y * v, y: g.wall.start.y + g.dir.y * u + g.dir.x * v });
    const t = g.wall.thickness / 2;
    if (o.kind === 'window') {
      for (const v of [-t, 0, t]) {
        const a = at(o.offset, v);
        const c = at(o.offset + o.width, v);
        s.line(a.x, a.y, c.x, c.y, v === 0 ? 'lh' : 'lt');
      }
    } else {
      const a = at(o.offset, t);
      const c = at(o.offset + o.width, t);
      s.line(a.x, a.y, c.x, c.y, 'dash');
    }
  }
  // Floor items first, wall cabinets dashed on top, benchtops thin.
  const order = [...d.room.items].sort((a, c) => Number(isWallCab(a)) - Number(isWallCab(c)));
  for (const i of order) {
    const poly = planOutline(i).map(P);
    const cls = isWallCab(i) ? 'dash' : i.kind === 'panel' && (i.panelType === 'benchtop' || i.panelType === 'splashback') ? 'lt' : 'front';
    s.poly(poly, cls);
    if (i.kind === 'cabinet') {
      const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
      const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
      s.text(cx, cy + (isWallCab(i) ? 3 : 0), i.label, 'tl');
    }
  }
  // Interior wall dimensions.
  const faces = d.interiorFaceIds.size ? d.faces.filter((f) => d.interiorFaceIds.has(f.id)) : [];
  for (const f of faces) {
    const a = P(f.a);
    const c = P(f.b);
    // Offset towards the room (normal points into the room; paper y is flipped).
    const nx = f.normal.x;
    const ny = -f.normal.y;
    const sideSign = Math.sign((c.x - a.x) * ny - (c.y - a.y) * nx) || 1;
    // Drawn outside the walls (clear of the cabinets), measuring the finished inside face.
    const wallT = (d.walls.get(f.wallId)?.wall.thickness ?? 100) / M.scale;
    s.dim(a.x, a.y, c.x, c.y, -(wallT + 7) * sideSign, mm(f.length));
  }
  s.text(AREA.x + 4, AREA.y + 4, `Plan — ${d.room.name}`, 'tb');
  return { title: `Plan — ${d.room.name}`, svg: wrap(doc, meta, s.toString(), M.scale) };
}

interface ElevItem {
  item: Item;
  build: ItemBuild;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
}

/** Items standing against a wall face, with their extent along it. */
function itemsOnFace(d: DerivedRoom, f: WallFace): ElevItem[] {
  const xAxis = { x: -f.normal.y, y: f.normal.x };
  const rot = Math.atan2(xAxis.y, xAxis.x);
  const out: ElevItem[] = [];
  for (const it of d.room.items) {
    const build = d.builds.get(it.id);
    if (!build || angleDiff(it.placement.rotation, rot) > 0.01) continue;
    const b = build.bounds;
    const back = localToWorld2(it.placement, { x: b.x, y: b.y + b.sy });
    if (Math.abs(dot(sub(back, f.a), f.normal)) > 5) continue;
    const u0 = dot(sub(back, f.a), xAxis);
    out.push({ item: it, build, u0, u1: u0 + b.sx, z0: it.placement.elevation + b.z, z1: it.placement.elevation + b.z + b.sz });
  }
  return out;
}

export function elevationSheet(doc: ProjectDocument, d: DerivedRoom, f: WallFace, wallName: string, meta: SheetMeta): DrawingSheet | null {
  const items = itemsOnFace(d, f);
  if (!items.length) return null;
  const xAxis = { x: -f.normal.y, y: f.normal.x };
  const U = (p: Vec2) => dot(sub(p, f.a), xAxis);
  const ub = U(f.b);
  const fu0 = Math.min(0, ub);
  const fu1 = Math.max(0, ub);
  const wallH = d.walls.get(f.wallId)?.wall.height ?? d.room.ceilingHeight;
  const M = fitMapper(fu0 - 300, -500, fu1 + 500, wallH + 200, 12);
  const X = M.x;
  const Y = M.y;
  const s = new Svg();
  // Wall outline and floor line.
  s.rect(X(fu0), Y(0), X(fu1) - X(fu0), Y(wallH) - Y(0), 'lt');
  s.line(X(fu0) - 6, Y(0), X(fu1) + 6, Y(0), 'lh');
  // Openings in this wall.
  const g = d.walls.get(f.wallId);
  for (const o of d.room.openings.filter((x) => x.wallId === f.wallId && g)) {
    const pa = { x: g!.wall.start.x + g!.dir.x * o.offset, y: g!.wall.start.y + g!.dir.y * o.offset };
    const pb = { x: g!.wall.start.x + g!.dir.x * (o.offset + o.width), y: g!.wall.start.y + g!.dir.y * (o.offset + o.width) };
    const a = Math.min(U(pa), U(pb));
    const c = Math.max(U(pa), U(pb));
    s.rect(X(a), Y(o.sill), X(c) - X(a), Y(o.sill + o.height) - Y(o.sill), 'l');
    if (o.kind === 'window') s.line(X((a + c) / 2), Y(o.sill), X((a + c) / 2), Y(o.sill + o.height), 'lt');
  }
  const proj = (it: Item, p: Part) => {
    const bx = p.box;
    const c = [
      localToWorld2(it.placement, { x: bx.x, y: bx.y }),
      localToWorld2(it.placement, { x: bx.x + bx.sx, y: bx.y }),
      localToWorld2(it.placement, { x: bx.x, y: bx.y + bx.sy }),
      localToWorld2(it.placement, { x: bx.x + bx.sx, y: bx.y + bx.sy }),
    ].map(U);
    return { u0: Math.min(...c), u1: Math.max(...c), z0: it.placement.elevation + bx.z, z1: it.placement.elevation + bx.z + bx.sz };
  };
  // Draw back-to-front: splashbacks and tops, then cabinets, then labels on top of everything.
  const panelFirst = [...items].sort((a, c) => Number(a.item.kind === 'cabinet') - Number(c.item.kind === 'cabinet'));
  for (const e of panelFirst) {
    const it = e.item;
    if (it.kind === 'panel') {
      const soft = it.panelType === 'benchtop' || it.panelType === 'splashback';
      s.rect(X(e.u0), Y(e.z0), X(e.u1) - X(e.u0), Y(e.z1) - Y(e.z0), soft ? 'top' : 'front');
      continue;
    }
    s.rect(X(e.u0), Y(e.z0), X(e.u1) - X(e.u0), Y(e.z1) - Y(e.z0), 'l');
    for (const p of e.build.parts) {
      if (p.role !== 'kick') continue;
      const r = proj(it, p);
      s.rect(X(r.u0), Y(r.z0), X(r.u1) - X(r.u0), Y(r.z1) - Y(r.z0), 'lt');
    }
    for (const a of e.build.appliances) {
      const r = proj(it, { box: a.box } as Part);
      s.rect(X(r.u0), Y(r.z0), X(r.u1) - X(r.u0), Y(r.z1) - Y(r.z0), 'app');
      s.line(X(r.u0), Y(r.z0), X(r.u1), Y(r.z1), 'lt');
      s.line(X(r.u0), Y(r.z1), X(r.u1), Y(r.z0), 'lt');
      s.text((X(r.u0) + X(r.u1)) / 2, (Y(r.z0) + Y(r.z1)) / 2 - 3, a.label, 't');
    }
    for (const p of e.build.parts) {
      if (p.role !== 'door' && p.role !== 'drawer-front' && p.role !== 'blind-panel') continue;
      if (p.facing && p.facing !== 'y-') continue; // return-wing doors face another wall
      const r = proj(it, p);
      const x0 = X(r.u0);
      const x1 = X(r.u1);
      const y0 = Y(r.z0);
      const y1 = Y(r.z1);
      s.rect(x0, y1, x1 - x0, y0 - y1, 'front');
      if (p.frontProfile === 'shaker') {
        const inset = Math.min(70, 0.22 * Math.min(r.u1 - r.u0, r.z1 - r.z0)) / M.scale;
        s.rect(x0 + inset, y1 + inset, x1 - x0 - 2 * inset, y0 - y1 - 2 * inset, 'lt');
      }
      if (p.role === 'door' && p.hinge) {
        // Standard opening symbol: lines from the hinge side corners to the middle of the free edge.
        const hx = p.hinge === 'left' ? x0 : x1;
        const fx = p.hinge === 'left' ? x1 : x0;
        const my = (y0 + y1) / 2;
        s.line(hx, y0, fx, my, 'hinge');
        s.line(hx, y1, fx, my, 'hinge');
      }
    }
    for (const h of e.build.hardware) {
      const v = h.visual;
      if (!v || v.kind === 'tube' || (v.facing && v.facing !== 'y-')) continue;
      const w = localToWorld2(it.placement, { x: v.center.x, y: v.center.y });
      const u = U(w);
      const z = it.placement.elevation + v.center.z;
      if (v.kind === 'knob') s.raw(`<circle class="cs-lh" cx="${n1(X(u))}" cy="${n1(Y(z))}" r="${n1(14 / M.scale)}"/>`);
      else if (v.axis === 'z') s.line(X(u), Y(z - v.length / 2), X(u), Y(z + v.length / 2), 'lh');
      else s.line(X(u - v.length / 2), Y(z), X(u + v.length / 2), Y(z), 'lh');
    }
  }
  // Labels: in the kick zone for floor-standing cabinets, above wall cabinets.
  for (const e of items) {
    const it = e.item;
    if (it.kind !== 'cabinet') continue;
    const k = it.params.kickHeight;
    const cx = (X(e.u0) + X(e.u1)) / 2;
    if (k >= 60 && !isWallCab(it)) s.text(cx, Y(e.z0 + k / 2), it.label, 'tl');
    else s.text(cx, Y(e.z1) - 3.2, it.label, 'tl');
  }
  // Width chains: floor-standing items below the floor line, wall cabinets above them.
  const chain = (list: ElevItem[], z: number, off: number) => {
    const sorted = [...list].sort((a, c) => a.u0 - c.u0);
    let cursor = fu0;
    for (const e of sorted) {
      if (e.u0 - cursor > 1) s.dim(X(cursor), Y(z), X(e.u0), Y(z), off, mm(e.u0 - cursor));
      s.dim(X(e.u0), Y(z), X(e.u1), Y(z), off, mm(e.u1 - e.u0));
      cursor = Math.max(cursor, e.u1);
    }
    if (fu1 - cursor > 1) s.dim(X(cursor), Y(z), X(fu1), Y(z), off, mm(fu1 - cursor));
  };
  const cabs = items.filter((e) => e.item.kind === 'cabinet');
  const low = cabs.filter((e) => !isWallCab(e.item));
  const high = cabs.filter((e) => isWallCab(e.item));
  if (low.length) chain(low, 0, 7);
  if (high.length) chain(high, Math.max(...high.map((e) => e.z1)), -7);
  s.dim(X(fu0), Y(0), X(fu1), Y(0), 15, mm(fu1 - fu0));
  // Height chain on the right: every distinct cabinet/top level.
  const levels = [...new Set([0, ...items.flatMap((e) => [e.z0, e.z1]).map((z) => Math.round(z * 10) / 10)])].filter((z) => z >= 0).sort((a, c) => a - c);
  for (let i = 0; i < levels.length - 1; i++) s.dim(X(fu1), Y(levels[i]), X(fu1), Y(levels[i + 1]), 8, mm(levels[i + 1] - levels[i]));
  if (levels.length > 2) s.dim(X(fu1), Y(0), X(fu1), Y(levels[levels.length - 1]), 16, mm(levels[levels.length - 1]));
  const title = `Elevation — wall ${wallName}`;
  s.text(AREA.x + 4, AREA.y + 4, title, 'tb');
  return { title, svg: wrap(doc, { ...meta, title }, s.toString(), M.scale) };
}

/** Plan plus one elevation per wall face that has cabinets against it. */
export function drawingSheets(doc: ProjectDocument, d: DerivedRoom, wallName: (wallId: string) => string): DrawingSheet[] {
  const faces = d.interiorFaceIds.size ? d.faces.filter((f) => d.interiorFaceIds.has(f.id)) : d.faces;
  const elevFaces = faces.filter((f) => itemsOnFace(d, f).some((e) => e.item.kind === 'cabinet'));
  const total = 1 + elevFaces.length;
  const sheets: DrawingSheet[] = [planSheet(doc, d, { title: `Plan — ${d.room.name}`, sheet: 1, of: total })];
  elevFaces.forEach((f, i) => {
    const sh = elevationSheet(doc, d, f, wallName(f.wallId), { title: '', sheet: i + 2, of: total });
    if (sh) sheets.push(sh);
  });
  return sheets;
}

/** Printable HTML (one A3 landscape page per sheet) for PDF export. */
export function sheetsToHtml(sheets: DrawingSheet[], title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:420mm 297mm;margin:0}html,body{margin:0;padding:0;background:#fff}.sheet{width:420mm;height:297mm;page-break-after:always;break-after:page;overflow:hidden}.sheet:last-child{page-break-after:auto;break-after:auto}svg{display:block;width:420mm;height:297mm}</style></head><body>${sheets.map((s) => `<div class="sheet">${s.svg}</div>`).join('')}</body></html>`;
}

