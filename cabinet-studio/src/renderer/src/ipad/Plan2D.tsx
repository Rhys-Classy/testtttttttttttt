// Touch 2D view for the iPad build: plan and wall elevations drawn in screen space
// (constant text/stroke sizes), with drag, pan, pinch, long-press and tap-to-place.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react';
import {
  itemsOnFace,
  planOutline,
  projectPartOnFace,
  updateItem,
  updateOpening,
  wallPieces,
  type DerivedRoom,
  type ElevItem,
  type Item,
  type OpeningKind,
  type WallFace,
  type WallGeometry,
} from '@engine/index';
import { addOpeningAt, applySnap, createFromLibrary } from '../state/actions';
import { useDerived, useStore } from '../state/store';
import { elevationFace, wallName } from '../viewport/views';
import { boundsOfPoints, fitView, gridLines, panBy, pinch, pointInPolygon, screenToWorld, worldToScreen, zoomAt, type Bounds2D, type P2, type Size2D, type View2D } from './geometry2d';

interface Hit {
  kind: 'item' | 'wall' | 'opening';
  id: string;
  poly: P2[];
  /** Elevation only: the item's extent on the face. */
  e?: ElevItem;
}

type Mode = 'idle' | 'pending' | 'item' | 'opening' | 'pan' | 'pinch' | 'done';
interface Gesture {
  mode: Mode;
  hit: Hit | null;
  start: P2; // screen
  last: P2; // screen
  startWorld: P2;
  timer: number | null;
  long: boolean;
  grab: P2;
  elev0: number;
  uC0: number;
  depth: number;
  openGrab: number;
  pair: [P2, P2] | null;
}

const rectPoly = (u0: number, z0: number, u1: number, z1: number): P2[] => [{ x: u0, y: z0 }, { x: u1, y: z0 }, { x: u1, y: z1 }, { x: u0, y: z1 }];
const isSoftPanel = (i: Item) => i.kind === 'panel' && (i.panelType === 'benchtop' || i.panelType === 'splashback');
const isWallCab = (i: Item) => i.kind === 'cabinet' && i.placement.elevation > 1000;
const at = (g: WallGeometry, u: number, v: number): P2 => ({ x: g.wall.start.x + g.dir.x * u - g.dir.y * v, y: g.wall.start.y + g.dir.y * u + g.dir.x * v });
const pathOf = (pts: P2[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z';
const mmText = (v: number) => String(Math.round(v));
const centroid = (pts: P2[]): P2 => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });

function faceBounds(d: DerivedRoom, f: WallFace) {
  const xAxis = { x: -f.normal.y, y: f.normal.x };
  const ub = (f.b.x - f.a.x) * xAxis.x + (f.b.y - f.a.y) * xAxis.y;
  return { fu0: Math.min(0, ub), fu1: Math.max(0, ub), wallH: d.walls.get(f.wallId)?.wall.height ?? d.room.ceilingHeight, xAxis };
}

export function Plan2D(): ReactElement {
  const d = useDerived();
  const viewMode = useStore((s) => s.view);
  const elevationWallId = useStore((s) => s.elevationWallId);
  const selection = useStore((s) => s.selection);
  const guides = useStore((s) => s.guides);
  const doc = useStore((s) => s.doc);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size2D>({ w: 0, h: 0 });
  const [view, setView] = useState<View2D>({ cx: 0, cy: 0, scale: 0.1 });
  const sizeRef = useRef(size);
  const viewRef = useRef(view);
  sizeRef.current = size;
  viewRef.current = view;

  const plan = viewMode === 'plan';
  const face = !plan && elevationWallId ? elevationFace({ elevationWallId, selection }, d) : null;
  const eItems = useMemo(() => (face ? itemsOnFace(d, face) : []), [d, face]);

  // Hit shapes, topmost first, in the view's world coordinates.
  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    if (plan) {
      const items = d.room.items.filter((i) => !isSoftPanel(i));
      const rank = (i: Item) => (selection?.kind === 'item' && selection.id === i.id ? 0 : isWallCab(i) ? 1 : 2);
      for (const i of [...items].sort((a, b) => rank(a) - rank(b))) out.push({ kind: 'item', id: i.id, poly: planOutline(i) });
      for (const o of d.room.openings) {
        const g = d.walls.get(o.wallId);
        if (!g) continue;
        const t = Math.max(g.wall.thickness / 2, 60);
        out.push({ kind: 'opening', id: o.id, poly: [at(g, o.offset, -t), at(g, o.offset + o.width, -t), at(g, o.offset + o.width, t), at(g, o.offset, t)] });
      }
      for (const g of d.walls.values()) out.push({ kind: 'wall', id: g.wall.id, poly: g.outline });
    } else if (face) {
      const rank = (e: ElevItem) => (selection?.kind === 'item' && selection.id === e.item.id ? 0 : e.item.kind === 'cabinet' ? 1 : 2);
      for (const e of [...eItems].sort((a, b) => rank(a) - rank(b))) out.push({ kind: 'item', id: e.item.id, poly: rectPoly(e.u0, e.z0, e.u1, e.z1), e });
      const g = d.walls.get(face.wallId);
      const xAxis = { x: -face.normal.y, y: face.normal.x };
      const U = (p: P2) => (p.x - face.a.x) * xAxis.x + (p.y - face.a.y) * xAxis.y;
      for (const o of d.room.openings.filter((x) => x.wallId === face.wallId && g)) {
        const ua = U(at(g!, o.offset, 0));
        const ub = U(at(g!, o.offset + o.width, 0));
        out.push({ kind: 'opening', id: o.id, poly: rectPoly(Math.min(ua, ub), o.sill, Math.max(ua, ub), o.sill + o.height) });
      }
    }
    return out;
  }, [d, plan, face, eItems, selection]);

  const bounds = useMemo<Bounds2D | null>(() => {
    if (plan) {
      const pts: P2[] = [];
      for (const g of d.walls.values()) pts.push(...g.outline);
      for (const i of d.room.items) pts.push(...planOutline(i));
      return boundsOfPoints(pts);
    }
    if (!face) return null;
    const { fu0, fu1, wallH } = faceBounds(d, face);
    return { minX: fu0, maxX: fu1, minY: -250, maxY: Math.max(wallH, d.room.ceilingHeight) };
  }, [d, plan, face]);

  const live = useRef({ d, plan, face, hits, bounds });
  live.current = { d, plan, face, hits, bounds };

  const fit = useCallback(() => {
    const b = live.current.bounds;
    if (b && sizeRef.current.w > 0) setView(fitView(b, sizeRef.current, 40));
  }, []);
  const ready = size.w > 0;
  useEffect(fit, [fit, plan, face?.id, d.room.walls.length, ready]);

  // Read-only hook for automated UI tests (mirrors window.__cabinetEngine on desktop).
  useEffect(() => {
    const summary = (i: Item) => {
      const xs = planOutline(i).map((p) => p.x);
      const ys = planOutline(i).map((p) => p.y);
      const x0 = Math.round(Math.min(...xs));
      const x1 = Math.round(Math.max(...xs));
      return {
        id: i.id,
        label: i.label,
        type: i.kind === 'panel' ? i.panelType : 'cabinet',
        w: i.kind === 'cabinet' ? i.params.width : Math.round(i.width),
        x0,
        x1,
        cx: (x0 + x1) / 2,
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
        wall: !!i.wallId,
      };
    };
    const hook = {
      view: () => viewRef.current,
      mode: () => (live.current.plan ? 'plan' : 'elevation'),
      toScreen: (p: P2) => {
        const r = svgRef.current!.getBoundingClientRect();
        const s = worldToScreen(viewRef.current, sizeRef.current, p);
        return { x: r.left + s.x, y: r.top + s.y };
      },
      items: () => live.current.d.room.items.filter((i) => i.kind === 'cabinet').map(summary),
      allItems: () => live.current.d.room.items.map(summary),
    };
    (window as unknown as { __plan2d?: typeof hook }).__plan2d = hook;
    return () => {
      delete (window as unknown as { __plan2d?: typeof hook }).__plan2d;
    };
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
      setView((v) => zoomAt(v, sizeRef.current, { x: ev.clientX - r.left, y: ev.clientY - r.top }, f));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  // ───────────── interaction ─────────────
  const pointers = useRef(new Map<number, P2>());
  const g = useRef<Gesture>({ mode: 'idle', hit: null, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, startWorld: { x: 0, y: 0 }, timer: null, long: false, grab: { x: 0, y: 0 }, elev0: 0, uC0: 0, depth: 0, openGrab: 0, pair: null });
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const local = (e: { clientX: number; clientY: number }): P2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: P2) => screenToWorld(viewRef.current, sizeRef.current, p);
  const clearTimer = () => {
    if (g.current.timer != null) window.clearTimeout(g.current.timer);
    g.current.timer = null;
  };
  const endDrag = (cancel: boolean) => {
    const s = useStore.getState();
    if (g.current.mode === 'item' || g.current.mode === 'opening') {
      if (cancel) s.cancelPreview();
      else s.endPreview();
      useStore.setState({ guides: [] });
    }
  };
  /** Plan-space point for a world point of the current view (elevation maps u,z onto the wall face). */
  const planPoint = (w: P2, off = 0): P2 => {
    const f = live.current.face;
    if (live.current.plan || !f) return w;
    const x = { x: -f.normal.y, y: f.normal.x };
    return { x: f.a.x + x.x * w.x + f.normal.x * off, y: f.a.y + x.y * w.x + f.normal.y * off };
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    const p = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, p);
    const G = g.current;
    if (pointers.current.size >= 2) {
      clearTimer();
      endDrag(true);
      const [a, b] = [...pointers.current.values()];
      G.mode = 'pinch';
      G.pair = [a, b];
      return;
    }
    const w = toWorld(p);
    const hit = live.current.hits.find((h) => pointInPolygon(w, h.poly)) ?? null;
    Object.assign(G, { mode: 'pending', hit, start: p, last: p, startWorld: w, long: false });
    if (hit?.kind === 'item') {
      const it = live.current.d.room.items.find((i) => i.id === hit.id);
      if (it) {
        const c = hit.e ? { x: (hit.e.u0 + hit.e.u1) / 2, y: 0 } : (() => { const b = boundsOfPoints(planOutline(it))!; return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; })();
        G.grab = { x: c.x - w.x, y: c.y - w.y };
        G.elev0 = it.placement.elevation;
        G.uC0 = c.x;
        G.depth = live.current.d.builds.get(it.id)?.bounds.sy ?? 0;
      }
    } else if (hit?.kind === 'opening') {
      const o = live.current.d.room.openings.find((x) => x.id === hit.id);
      const wg = o && live.current.d.walls.get(o.wallId);
      if (o && wg) G.openGrab = o.offset - ((w.x - wg.wall.start.x) * wg.dir.x + (w.y - wg.wall.start.y) * wg.dir.y);
    }
    clearTimer();
    G.timer = window.setTimeout(() => {
      G.timer = null;
      if (G.mode !== 'pending') return;
      G.long = true;
      if (G.hit?.kind === 'item') {
        useStore.getState().select({ kind: 'item', id: G.hit.id });
        useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } });
      }
    }, 550);
  };

  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const G = g.current;
    if (G.mode === 'pinch') {
      if (pointers.current.size < 2 || !G.pair) return;
      const [a, b] = [...pointers.current.values()];
      const next: [P2, P2] = [a, b];
      const prev = G.pair;
      G.pair = next;
      setView((v) => pinch(v, sizeRef.current, prev, next));
      return;
    }
    const dist = Math.hypot(p.x - G.start.x, p.y - G.start.y);
    if (dist > 8) clearTimer();
    if (G.long || G.mode === 'done' || G.mode === 'idle') return;
    const s = useStore.getState();
    const L = live.current;
    if (G.mode === 'pending' && dist > 6) {
      const h = G.hit;
      if (h?.kind === 'item') {
        clearTimer();
        s.select({ kind: 'item', id: h.id });
        G.mode = 'item';
      } else if (h?.kind === 'opening' && L.plan) {
        clearTimer();
        s.select({ kind: 'opening', id: h.id });
        G.mode = 'opening';
      } else {
        clearTimer();
        G.mode = 'pan';
      }
    }
    const w = toWorld(p);
    if (G.mode === 'item' && G.hit) {
      const id = G.hit.id;
      if (L.plan) {
        const cursor = { x: w.x + G.grab.x, y: w.y + G.grab.y };
        s.preview((doc) => applySnap(doc, id, cursor));
      } else if (L.face) {
        const u = w.x + G.grab.x;
        const raw = G.elev0 + (w.y - G.startWorld.y);
        const gs = s.snap.gridSize;
        const elev = Math.max(0, s.snap.grid && gs > 0 ? Math.round(raw / gs) * gs : raw);
        const cursor = planPoint({ x: u, y: 0 }, G.depth / 2 + 5);
        s.preview((doc) => updateItem<Item>(applySnap(doc, id, cursor), id, (i) => ({ ...i, placement: { ...i.placement, elevation: elev } })));
      }
    } else if (G.mode === 'opening' && G.hit) {
      const o = L.d.room.openings.find((x) => x.id === G.hit!.id);
      const wg = o && L.d.walls.get(o.wallId);
      if (o && wg) {
        const t = (w.x - wg.wall.start.x) * wg.dir.x + (w.y - wg.wall.start.y) * wg.dir.y;
        const gs = s.snap.gridSize;
        let off = t + G.openGrab;
        if (s.snap.grid && gs > 0) off = Math.round(off / gs) * gs;
        off = Math.min(Math.max(off, 0), Math.max(0, wg.length - o.width));
        s.preview((doc) => updateOpening(doc, o.id, { offset: off }));
      }
    } else if (G.mode === 'pan') {
      const dx = p.x - G.last.x;
      const dy = p.y - G.last.y;
      setView((v) => panBy(v, dx, dy));
    }
    G.last = p;
  };

  const tap = (p: P2) => {
    const s = useStore.getState();
    const hit = g.current.hit;
    const w = toWorld(p);
    if (s.armed) {
      const armed = s.armed;
      const pp = planPoint(w, 300);
      if (armed.kind === 'opening') {
        addOpeningAt(armed.id as OpeningKind, planPoint(w), true);
      } else {
        const res = createFromLibrary(s.doc, armed);
        if (res) {
          const placed = applySnap(res.doc, res.id, pp);
          s.commit(() => placed);
          s.select({ kind: 'item', id: res.id });
        }
      }
      useStore.setState({ armed: null, guides: [] });
      return;
    }
    if (hit) {
      s.select({ kind: hit.kind, id: hit.id });
      return;
    }
    s.select(null);
    const now = performance.now();
    const lt = lastTap.current;
    if (lt && now - lt.t < 300 && Math.hypot(p.x - lt.x, p.y - lt.y) < 20) {
      lastTap.current = null;
      fit();
    } else lastTap.current = { t: now, x: p.x, y: p.y };
  };

  const up = (e: RPointerEvent<SVGSVGElement>, cancelled = false) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const G = g.current;
    clearTimer();
    if (G.mode === 'pinch') {
      if (pointers.current.size === 0) G.mode = 'idle';
      else G.mode = 'done';
      return;
    }
    if (G.mode === 'pending' && !G.long && !cancelled) tap(p);
    endDrag(cancelled);
    G.mode = pointers.current.size ? 'done' : 'idle';
  };

  // ───────────── drawing ─────────────
  const P = (x: number, y: number) => worldToScreen(view, size, { x, y });
  const sel = selection;
  const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id;
  const nodes: ReactElement[] = [];
  let hint: string | null = null;

  if (size.w > 0) {
    const tl = screenToWorld(view, size, { x: 0, y: 0 });
    const br = screenToWorld(view, size, { x: size.w, y: size.h });
    if (plan) {
      for (const [step, cls] of [[100, 'p2-grid'], [1000, 'p2-grid-major']] as const) {
        const xs = gridLines(tl.x, br.x, step, view.scale);
        const ys = gridLines(br.y, tl.y, step, view.scale);
        if (!xs.length) continue;
        const dd = xs.map((x) => `M${P(x, 0).x.toFixed(1)} 0V${size.h}`).join('') + ys.map((y) => `M0 ${P(0, y).y.toFixed(1)}H${size.w}`).join('');
        nodes.push(<path key={cls} className={cls} d={dd} />);
      }
      const centre = d.floorPolygon ? centroid(d.floorPolygon) : centroid([...d.walls.values()].flatMap((x) => [x.wall.start, x.wall.end]).concat({ x: 0, y: 0 }));
      if (d.floorPolygon) nodes.push(<path key="floor" className="p2-floor" d={pathOf(d.floorPolygon.map((q) => P(q.x, q.y)))} />);
      for (const wg of d.walls.values()) {
        for (const piece of wallPieces(wg, d.room.openings)) {
          if (piece.z0 === 0) nodes.push(<path key={`w${wg.wall.id}${nodes.length}`} className={isSel('wall', wg.wall.id) ? 'p2-wall p2-sel' : 'p2-wall'} d={pathOf(piece.polygon.map((q) => P(q.x, q.y)))} />);
        }
        // Length label just outside the wall's midpoint.
        const mid = at(wg, wg.length / 2, 0);
        const n = { x: -wg.dir.y, y: wg.dir.x };
        const sgn = (centre.x - mid.x) * n.x + (centre.y - mid.y) * n.y >= 0 ? -1 : 1;
        const m = P(mid.x, mid.y);
        const off = (wg.wall.thickness / 2) * view.scale + 12;
        nodes.push(<text key={`l${wg.wall.id}`} className="p2-dim" x={m.x + n.x * sgn * off} y={m.y - n.y * sgn * off}>{mmText(wg.length)}</text>);
      }
      for (const o of d.room.openings) {
        const wg = d.walls.get(o.wallId);
        if (!wg) continue;
        const t = wg.wall.thickness / 2;
        const S = (u: number, v: number) => { const q = at(wg, u, v); return P(q.x, q.y); };
        const cls = isSel('opening', o.id) ? 'p2-open p2-sel' : 'p2-open';
        if (o.kind === 'window') {
          for (const v of [-t, 0, t]) {
            const a = S(o.offset, v);
            const b = S(o.offset + o.width, v);
            nodes.push(<line key={`o${o.id}${v}`} className={cls} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
          }
        } else {
          const n = { x: -wg.dir.y, y: wg.dir.x };
          const mid = at(wg, wg.length / 2, 0);
          const sgn = d.floorPolygon && (centroid(d.floorPolygon).x - mid.x) * n.x + (centroid(d.floorPolygon).y - mid.y) * n.y < 0 ? -1 : 1;
          const H = S(o.offset, 0);
          const C = S(o.offset + o.width, 0);
          const O = S(o.offset, 0);
          const hw = at(wg, o.offset, 0);
          const ow = P(hw.x + n.x * sgn * o.width, hw.y + n.y * sgn * o.width);
          O.x = ow.x;
          O.y = ow.y;
          const r = o.width * view.scale;
          const sweep = (C.x - H.x) * (O.y - H.y) - (C.y - H.y) * (O.x - H.x) > 0 ? 1 : 0;
          nodes.push(<path key={`o${o.id}`} className={cls} d={`M${H.x} ${H.y}L${O.x} ${O.y}M${C.x} ${C.y}A${r} ${r} 0 0 ${sweep} ${O.x} ${O.y}`} />);
        }
      }
      const order = d.room.items.filter((i) => !isSoftPanel(i)).sort((a, b) => Number(isWallCab(a)) - Number(isWallCab(b)));
      for (const it of order) {
        const poly = planOutline(it).map((q) => P(q.x, q.y));
        const selected = isSel('item', it.id);
        nodes.push(<path key={`i${it.id}`} className={`p2-item${isWallCab(it) ? ' p2-wallcab' : ''}${selected ? ' p2-sel' : ''}`} d={pathOf(poly)} />);
        if (it.kind !== 'cabinet') continue;
        const b = d.builds.get(it.id)?.bounds;
        if (b) {
          const lw = (q: P2) => { const wq = { x: it.placement.x + Math.cos(it.placement.rotation) * q.x - Math.sin(it.placement.rotation) * q.y, y: it.placement.y + Math.sin(it.placement.rotation) * q.x + Math.cos(it.placement.rotation) * q.y }; return P(wq.x, wq.y); };
          const a = lw({ x: b.x, y: 0 });
          const c = lw({ x: b.x + b.sx, y: 0 });
          nodes.push(<line key={`f${it.id}`} className="p2-front" x1={a.x} y1={a.y} x2={c.x} y2={c.y} />);
        }
        const bb = boundsOfPoints(poly)!;
        const ctr = centroid(poly);
        const text = `${it.label} ${Math.round(it.params.width)}`;
        if (bb.maxX - bb.minX >= text.length * 7 + 6 && bb.maxY - bb.minY >= 18) {
          nodes.push(<text key={`t${it.id}`} className="p2-label" x={ctr.x} y={ctr.y}>{text}</text>);
          if (selected) nodes.push(<text key={`s${it.id}`} className="p2-sub" x={ctr.x} y={ctr.y + 14}>{`${Math.round(it.params.width)} × ${Math.round(it.params.depth)}`}</text>);
        }
      }
      for (const [i, gd] of guides.entries()) {
        const a = P(gd.a.x, gd.a.y);
        const b = P(gd.b.x, gd.b.y);
        nodes.push(<line key={`g${i}`} className="p2-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
      }
    } else if (!face) {
      hint = 'Pick a wall from the Wall menu';
    } else {
      const { fu0, fu1, wallH } = faceBounds(d, face);
      const ceil = d.room.ceilingHeight;
      const a = P(fu0, 0);
      const b = P(fu1, 0);
      nodes.push(<line key="floor" className="p2-floorline" x1={a.x - 10} y1={a.y} x2={b.x + 10} y2={b.y} />);
      const c0 = P(fu0, ceil);
      const c1 = P(fu1, ceil);
      nodes.push(<line key="ceil" className="p2-ceil" x1={c0.x} y1={c0.y} x2={c1.x} y2={c1.y} />);
      nodes.push(<path key="wallbox" className="p2-ceil" d={`M${a.x} ${a.y}L${c0.x} ${P(0, wallH).y}M${b.x} ${b.y}L${c1.x} ${P(0, wallH).y}`} />);
      for (const h of hits.filter((x) => x.kind === 'opening')) {
        const o = d.room.openings.find((x) => x.id === h.id)!;
        const p0 = P(h.poly[0].x, h.poly[0].y);
        const p1 = P(h.poly[2].x, h.poly[2].y);
        nodes.push(<rect key={`o${o.id}`} className={isSel('opening', o.id) ? 'p2-open p2-sel' : 'p2-open'} x={Math.min(p0.x, p1.x)} y={Math.min(p0.y, p1.y)} width={Math.abs(p1.x - p0.x)} height={Math.abs(p1.y - p0.y)} />);
      }
      const rect = (key: string, u0: number, z0: number, u1: number, z1: number, cls: string) => {
        const p0 = P(u0, z1);
        const p1 = P(u1, z0);
        return <rect key={key} className={cls} x={p0.x} y={p0.y} width={Math.max(0, p1.x - p0.x)} height={Math.max(0, p1.y - p0.y)} />;
      };
      const sorted = [...eItems].sort((x, y) => Number(x.item.kind === 'cabinet') - Number(y.item.kind === 'cabinet'));
      for (const e of sorted) {
        const it = e.item;
        const soft = isSoftPanel(it);
        nodes.push(rect(`e${it.id}`, e.u0, e.z0, e.u1, e.z1, `p2-item${soft ? ' p2-top' : ''}${isSel('item', it.id) ? ' p2-sel' : ''}`));
        if (it.kind !== 'cabinet') continue;
        for (const p of e.build.parts) {
          if (p.role !== 'door' && p.role !== 'drawer-front' && p.role !== 'blind-panel') continue;
          if (p.facing && p.facing !== 'y-') continue;
          const r = projectPartOnFace(it, p, face);
          nodes.push(rect(`p${it.id}${p.id ?? nodes.length}`, r.u0, r.z0, r.u1, r.z1, 'p2-door'));
        }
        const c = P((e.u0 + e.u1) / 2, e.z1);
        const wpx = (e.u1 - e.u0) * view.scale;
        const text = `${it.label} ${Math.round(it.params.width)}`;
        if (wpx >= text.length * 7 + 6) nodes.push(<text key={`t${it.id}`} className="p2-label" x={c.x} y={c.y + 14}>{text}</text>);
      }
      // Dimensions under the floor: each item's width, then the overall wall length.
      const y1 = a.y + 22;
      const y2 = a.y + 46;
      const dim = (key: string, u0: number, u1: number, y: number, txt: string) => {
        const p0 = P(u0, 0);
        const p1 = P(u1, 0);
        return (
          <g key={key} className="p2-dimg">
            <line x1={p0.x} y1={y} x2={p1.x} y2={y} />
            <line x1={p0.x} y1={y - 5} x2={p0.x} y2={y + 5} />
            <line x1={p1.x} y1={y - 5} x2={p1.x} y2={y + 5} />
            <text className="p2-dim" x={(p0.x + p1.x) / 2} y={y - 4}>{txt}</text>
          </g>
        );
      };
      for (const e of eItems.filter((x) => x.item.kind === 'cabinet')) nodes.push(dim(`d${e.item.id}`, e.u0, e.u1, y1, mmText(e.u1 - e.u0)));
      nodes.push(dim('dall', fu0, fu1, y2, mmText(fu1 - fu0)));
      nodes.push(<text key="name" className="p2-sub" x={12} y={22} textAnchor="start">{`Wall ${wallName(doc, face.wallId)}`}</text>);
    }
  }

  return (
    <svg
      ref={svgRef}
      className="plan2d"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => up(e)}
      onPointerCancel={(e) => up(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {nodes}
      {hint && <text className="p2-hint" x={size.w / 2} y={size.h / 2}>{hint}</text>}
    </svg>
  );
}
