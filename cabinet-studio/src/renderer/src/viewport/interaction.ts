// Pointer interaction in the viewport: select, drag-to-move with snapping, resize
// handles, opening dragging, wall drawing and the tape measure.
//
// Listeners are attached in the capture phase on the viewport container, so they run
// before the camera controls and can disable them when a drag starts on an object.

import {
  activeRoom,
  addWall,
  findItem,
  localToWorld2,
  snapTo,
  snapWallPoint,
  updateItem,
  updateOpening,
  type Item,
  type Vec2,
} from '@engine/index';
import { applySnap } from '../state/actions';
import { useStore } from '../state/store';
import type { PickInfo } from './meshes';
import type { RenderEngine } from './RenderEngine';

type P3 = { x: number; y: number; z: number };

const DRAG_PX = 4;
const S = () => useStore.getState();

interface Press {
  x: number;
  y: number;
  button: number;
  pick: PickInfo | null;
  moved: boolean;
}

type Drag =
  | { kind: 'item'; id: string; grab: Vec2; startHit: P3; startElevation: number; vertical: boolean }
  | { kind: 'resize'; id: string; handle: NonNullable<PickInfo['handle']>; startHit: P3; start: Item; axis: Vec2 }
  | { kind: 'opening'; id: string; wallId: string; grab: number };

function itemDims(i: Item) {
  return i.kind === 'cabinet' ? { w: i.params.width, d: i.params.depth, h: i.params.height } : { w: i.width, d: i.depth, h: i.height };
}

export class Interaction {
  private press: Press | null = null;
  private drag: Drag | null = null;
  private hoverRaf = 0;

  constructor(
    private el: HTMLElement,
    private engine: RenderEngine,
  ) {
    el.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    el.addEventListener('dblclick', this.onDblClick);
    el.addEventListener('contextmenu', this.onContext);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    this.el.removeEventListener('dblclick', this.onDblClick);
    this.el.removeEventListener('contextmenu', this.onContext);
    cancelAnimationFrame(this.hoverRaf);
  }

  private inCanvas(e: PointerEvent | MouseEvent): boolean {
    return e.target instanceof HTMLCanvasElement || (e.target as HTMLElement)?.closest?.('.viewport-overlay') != null;
  }

  /**
   * Plan point under the cursor; uses the elevation plane in elevation views. When
   * `depth` is given (placing an item) and the pointer is over a wall in front of the
   * floor point, returns a point just off that wall's face so the item attaches to it.
   */
  planUnderCursor(clientX: number, clientY: number, z = 0, depth?: number): Vec2 | null {
    const v = S().view;
    if (depth != null && v === '3d') {
      const wall = this.engine.wallSurfaceHit(clientX, clientY);
      const dPlane = this.engine.planeDistance(clientX, clientY, z);
      if (wall && (dPlane == null || wall.distance < dPlane)) {
        const k = depth / 2 + 5;
        return { x: wall.point.x + wall.normal.x * k, y: wall.point.y + wall.normal.y * k };
      }
    }
    if (v === 'front' || v === 'side') {
      const dir = this.engine.viewDirection();
      const b = this.engine.roomBounds;
      const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z };
      const hit = this.engine.hitPlane(clientX, clientY, { x: dir.x, y: dir.y, z: 0 }, centre);
      return hit ? { x: hit.x, y: hit.y } : null;
    }
    return this.engine.planPoint(clientX, clientY, z);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.inCanvas(e)) return;
    const s = S();
    useStore.setState({ contextMenu: null });
    if (s.view === 'walk') {
      this.engine.lockWalk();
      return;
    }
    if (e.button !== 0) {
      this.press = { x: e.clientX, y: e.clientY, button: e.button, pick: null, moved: false };
      return;
    }
    if (s.tool === 'wall' || s.tool === 'measure') {
      this.engine.setControlsEnabled(false);
      this.press = { x: e.clientX, y: e.clientY, button: 0, pick: null, moved: false };
      return;
    }
    const pick = this.engine.pick(e.clientX, e.clientY);
    this.press = { x: e.clientX, y: e.clientY, button: 0, pick, moved: false };
    if (!pick) return;
    // Pressing on something: it gets selected and dragging it must not orbit the camera.
    this.engine.setControlsEnabled(false);
    if (pick.kind === 'handle') return;
    const cur = s.selection;
    // Second click on a front of the already-selected cabinet selects that door/drawer.
    if (pick.kind === 'item' && cur?.kind === 'item' && cur.id === pick.id && pick.frontKey) {
      if (cur.front !== pick.frontKey) s.select({ kind: 'item', id: pick.id, front: pick.frontKey });
      return;
    }
    if (cur?.kind === pick.kind && cur.id === pick.id && !cur.front) return;
    s.select({ kind: pick.kind, id: pick.id });
  };

  private startDrag(e: PointerEvent): void {
    const s = S();
    const p = this.press?.pick;
    if (!p) return;
    if (p.kind === 'item' || p.kind === 'handle') {
      const item = findItem(s.doc, p.id);
      if (!item) return;
      const { w, d, h } = itemDims(item);
      const centre = localToWorld2(item.placement, { x: w / 2, y: d / 2 });
      if (p.kind === 'handle' && p.handle) {
        const axis = { x: Math.cos(item.placement.rotation), y: Math.sin(item.placement.rotation) };
        const hz = item.placement.elevation + (p.handle === 'height' ? h : h / 2);
        const startHit = this.hitFor(e.clientX, e.clientY, { ...centre, z: hz }, p.handle === 'height');
        if (!startHit) return;
        this.drag = { kind: 'resize', id: item.id, handle: p.handle, startHit, start: item, axis };
        return;
      }
      const vertical = s.view === 'front' || s.view === 'side';
      const startHit = this.hitFor(e.clientX, e.clientY, { ...centre, z: item.placement.elevation }, vertical);
      if (!startHit) return;
      this.drag = { kind: 'item', id: item.id, grab: { x: centre.x - startHit.x, y: centre.y - startHit.y }, startHit, startElevation: item.placement.elevation, vertical };
    } else if (p.kind === 'opening') {
      const o = activeRoom(s.doc).openings.find((x) => x.id === p.id);
      const w = o && activeRoom(s.doc).walls.find((x) => x.id === o.wallId);
      const hit = this.planUnderCursor(e.clientX, e.clientY, o ? o.sill : 0);
      if (!o || !w || !hit) return;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
      const u = ((hit.x - w.start.x) * (w.end.x - w.start.x) + (hit.y - w.start.y) * (w.end.y - w.start.y)) / len;
      this.drag = { kind: 'opening', id: o.id, wallId: w.id, grab: o.offset - u };
    }
  }

  /** Horizontal plane hit at `p.z` (plan/3D) or a camera-facing vertical plane through `p`. */
  private hitFor(clientX: number, clientY: number, p: P3, vertical: boolean): P3 | null {
    if (vertical) {
      const dir = this.engine.viewDirection();
      const n = { x: dir.x, y: dir.y, z: 0 };
      if (Math.hypot(n.x, n.y) < 1e-3) return null;
      return this.engine.hitPlane(clientX, clientY, n, p);
    }
    return this.engine.hitPlane(clientX, clientY, { x: 0, y: 0, z: 1 }, p);
  }

  private onMove = (e: PointerEvent): void => {
    const s = S();
    if (s.view === 'walk') return;
    if (this.press && !this.press.moved && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_PX) {
      this.press.moved = true;
      if (this.press.button === 0 && s.tool === 'select') this.startDrag(e);
    }
    if (this.drag) {
      this.updateDrag(e);
      return;
    }
    if (!this.inCanvas(e) && !this.press) return;
    if (s.tool === 'wall') {
      const cur = this.planUnderCursor(e.clientX, e.clientY);
      if (!cur) return;
      const pts = s.drawing.points;
      const snap = snapWallPoint(cur, pts[pts.length - 1] ?? null, activeRoom(s.doc).walls, s.snap.grid ? s.snap.gridSize : 1, e.shiftKey);
      useStore.setState({ drawing: { ...s.drawing, cursor: snap.point } });
      this.engine.requestRender();
      return;
    }
    if (s.tool === 'measure') {
      const cur = this.planUnderCursor(e.clientX, e.clientY);
      if (!cur) return;
      const snap = snapWallPoint(cur, null, activeRoom(s.doc).walls, s.snap.grid ? s.snap.gridSize : 1, true);
      useStore.setState({ measure: { ...s.measure, cursor: snap.point } });
      this.engine.requestRender();
      return;
    }
    if (!this.press && e.buttons === 0) {
      cancelAnimationFrame(this.hoverRaf);
      const { clientX, clientY } = e;
      this.hoverRaf = requestAnimationFrame(() => {
        const p = this.engine.pick(clientX, clientY);
        const id = p && p.kind !== 'handle' ? p.id : null;
        if (id !== S().hoverId) useStore.setState({ hoverId: id });
        this.el.style.cursor = p ? (p.kind === 'handle' ? (p.handle === 'height' ? 'ns-resize' : 'ew-resize') : 'pointer') : '';
      });
    }
  };

  private updateDrag(e: PointerEvent): void {
    const s = S();
    const d = this.drag!;
    if (d.kind === 'item') {
      const item = findItem(s.doc, d.id);
      if (!item) return;
      const { w, d: depth } = itemDims(item);
      const centre = localToWorld2(item.placement, { x: w / 2, y: depth / 2 });
      const hit = this.hitFor(e.clientX, e.clientY, { ...centre, z: d.vertical ? d.startHit.z : d.startElevation }, d.vertical);
      if (!hit) return;
      let elevation = d.startElevation;
      if (d.vertical) {
        elevation = Math.max(0, snapTo(d.startElevation + (hit.z - d.startHit.z), s.snap.grid ? s.snap.gridSize : 1));
      }
      let cursor = { x: hit.x + d.grab.x, y: hit.y + d.grab.y };
      // Pointer over a wall in 3D: attach to the face being pointed at.
      if (!d.vertical && s.view === '3d') {
        const wall = this.engine.wallSurfaceHit(e.clientX, e.clientY);
        const dPlane = this.engine.planeDistance(e.clientX, e.clientY, d.startElevation);
        if (wall && (dPlane == null || wall.distance < dPlane)) {
          const k = (item.kind === 'cabinet' ? item.params.depth + 18 : item.depth) / 2 + 5;
          cursor = { x: wall.point.x + wall.normal.x * k, y: wall.point.y + wall.normal.y * k };
        }
      }
      s.preview((doc) => {
        const moved = elevation !== item.placement.elevation ? updateItem<Item>(doc, d.id, (i) => ({ ...i, placement: { ...i.placement, elevation } })) : doc;
        return applySnap(moved, d.id, cursor);
      });
      return;
    }
    if (d.kind === 'resize') {
      const st = d.start;
      const dims = itemDims(st);
      const vertical = d.handle === 'height';
      const centre = localToWorld2(st.placement, { x: dims.w / 2, y: dims.d / 2 });
      const hit = this.hitFor(e.clientX, e.clientY, { ...centre, z: d.startHit.z }, vertical);
      if (!hit) return;
      const step = s.snap.grid ? s.snap.gridSize : 1;
      if (vertical) {
        const nh = Math.max(100, snapTo(dims.h + (hit.z - d.startHit.z), step));
        s.preview((doc) =>
          updateItem<Item>(doc, d.id, (i) => (i.kind === 'cabinet' ? { ...i, params: { ...i.params, height: nh } } : { ...i, height: nh })),
        );
        return;
      }
      const du = (hit.x - d.startHit.x) * d.axis.x + (hit.y - d.startHit.y) * d.axis.y;
      const raw = d.handle === 'width-right' ? dims.w + du : dims.w - du;
      const nw = Math.max(st.kind === 'cabinet' ? 100 : 3, snapTo(raw, step));
      const shift = d.handle === 'width-left' ? dims.w - nw : 0;
      s.preview((doc) =>
        updateItem<Item>(doc, d.id, (i) => {
          const placement = { ...st.placement, x: st.placement.x + d.axis.x * shift, y: st.placement.y + d.axis.y * shift };
          return i.kind === 'cabinet' ? { ...i, placement, params: { ...i.params, width: nw } } : { ...i, placement, width: nw };
        }),
      );
      return;
    }
    // Opening: slide along its wall.
    const o = activeRoom(s.doc).openings.find((x) => x.id === d.id);
    const w = activeRoom(s.doc).walls.find((x) => x.id === d.wallId);
    const hit = this.planUnderCursor(e.clientX, e.clientY, o?.sill ?? 0);
    if (!o || !w || !hit) return;
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
    const u = ((hit.x - w.start.x) * (w.end.x - w.start.x) + (hit.y - w.start.y) * (w.end.y - w.start.y)) / len;
    const offset = Math.min(Math.max(0, snapTo(u + d.grab, s.snap.grid ? s.snap.gridSize : 1)), Math.max(0, len - o.width));
    s.preview((doc) => updateOpening(doc, d.id, { offset }));
  }

  private onUp = (e: PointerEvent): void => {
    const s = S();
    const press = this.press;
    this.press = null;
    if (this.drag) {
      this.drag = null;
      s.endPreview();
      useStore.setState({ guides: [] });
      this.engine.setControlsEnabled(true);
      return;
    }
    this.engine.setControlsEnabled(true);
    if (!press || press.moved) return;
    if (press.button === 2) {
      const pick = this.engine.pick(e.clientX, e.clientY);
      if (pick && pick.kind !== 'handle') s.select({ kind: pick.kind, id: pick.id });
      if (pick || S().selection) useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } });
      return;
    }
    if (press.button !== 0) return;
    if (s.tool === 'wall') {
      this.wallClick(e);
      return;
    }
    if (s.tool === 'measure') {
      const p = s.measure.cursor ?? this.planUnderCursor(e.clientX, e.clientY);
      if (!p) return;
      if (!s.measure.a || s.measure.b) useStore.setState({ measure: { a: p, b: null, cursor: p } });
      else useStore.setState({ measure: { ...s.measure, b: p } });
      this.engine.requestRender();
      return;
    }
    if (!press.pick) s.select(null);
  };

  private wallClick(e: PointerEvent): void {
    const s = S();
    const p = s.drawing.cursor ?? this.planUnderCursor(e.clientX, e.clientY);
    if (!p) return;
    const pts = s.drawing.points;
    const last = pts[pts.length - 1];
    if (!last) {
      useStore.setState({ drawing: { points: [p], cursor: p, typed: '' } });
      return;
    }
    if (Math.hypot(p.x - last.x, p.y - last.y) < 10) return;
    commitWallSegment(last, p);
    const closed = pts.length > 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 1;
    useStore.setState({ drawing: closed ? { points: [], cursor: null, typed: '' } : { points: [...pts, p], cursor: p, typed: '' } });
    if (closed) s.toast('success', 'Room closed.');
  }

  private onDblClick = (): void => {
    if (S().tool === 'wall') useStore.setState({ drawing: { points: [], cursor: null, typed: '' } });
  };

  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
  };
}

export function commitWallSegment(a: Vec2, b: Vec2): void {
  const s = S();
  const room = activeRoom(s.doc);
  const ref = room.walls[room.walls.length - 1];
  s.commit((doc) => addWall(doc, a, b, ref?.thickness ?? 110, room.ceilingHeight).doc);
}
