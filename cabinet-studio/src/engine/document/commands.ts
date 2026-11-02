// Pure document operations. Each returns a new document (structural sharing), which is
// what makes undo/redo, autosave and change detection cheap and reliable.

import { frameOf, localToWorld2 } from '../math/placement';
import { add, normalizeAngle, scale, type Vec2 } from '../math/vec';
import { newId } from '../model/ids';
import type { CabinetItem, Id, Item, Opening, ProjectDocument, Room, Wall } from '../model/types';
import { rectangularWalls } from '../room/walls';

export function activeRoom(doc: ProjectDocument): Room {
  return doc.rooms.find((r) => r.id === doc.activeRoomId) ?? doc.rooms[0];
}

const touch = (doc: ProjectDocument): ProjectDocument => ({ ...doc, updatedAt: new Date().toISOString() });

export function updateRoom(doc: ProjectDocument, fn: (room: Room) => Room): ProjectDocument {
  const room = activeRoom(doc);
  const next = fn(room);
  if (next === room) return doc;
  return touch({ ...doc, rooms: doc.rooms.map((r) => (r.id === room.id ? next : r)) });
}

export function findItem(doc: ProjectDocument, id: Id): Item | undefined {
  return activeRoom(doc).items.find((i) => i.id === id);
}

/** Reserve the next human-readable label ("C1", "P3", "BT1"...). */
export function nextLabel(doc: ProjectDocument, kind: 'cabinet' | 'panel'): { doc: ProjectDocument; label: string } {
  const prefix = kind === 'cabinet' ? 'C' : 'P';
  const used = new Set(doc.rooms.flatMap((r) => r.items.map((i) => i.label)));
  let n = doc.counters[kind] + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return { doc: { ...doc, counters: { ...doc.counters, [kind]: n } }, label: `${prefix}${n}` };
}

export function addItem(doc: ProjectDocument, item: Item): ProjectDocument {
  return updateRoom(doc, (r) => ({ ...r, items: [...r.items, item] }));
}

export function updateItem<T extends Item>(doc: ProjectDocument, id: Id, fn: (item: T) => T): ProjectDocument {
  return updateRoom(doc, (r) => {
    let changed = false;
    const items = r.items.map((i) => {
      if (i.id !== id) return i;
      const next = fn(i as T);
      if (next !== i) changed = true;
      return next;
    });
    return changed ? { ...r, items } : r;
  });
}

export function updateCabinetParams(doc: ProjectDocument, id: Id, patch: Partial<CabinetItem['params']>): ProjectDocument {
  return updateItem<CabinetItem>(doc, id, (c) => (c.kind === 'cabinet' ? { ...c, params: { ...c.params, ...patch } } : c));
}

export function removeItems(doc: ProjectDocument, ids: Id[]): ProjectDocument {
  const set = new Set(ids);
  return updateRoom(doc, (r) => (r.items.some((i) => set.has(i.id)) ? { ...r, items: r.items.filter((i) => !set.has(i.id)) } : r));
}

function cloneItem(item: Item, label: string): Item {
  const copy = structuredClone(item) as Item;
  copy.id = newId(item.kind === 'cabinet' ? 'cab' : 'pnl');
  copy.label = label;
  if (copy.kind === 'cabinet') copy.params.fronts = copy.params.fronts.map((f) => ({ ...f, id: newId('fs') }));
  if (copy.kind === 'panel') copy.auto = false;
  return copy;
}

const itemWidth = (i: Item) => (i.kind === 'cabinet' ? i.params.width : i.width);

/** Duplicate items, placing each copy directly to the right of its original. */
export function duplicateItems(doc: ProjectDocument, ids: Id[]): { doc: ProjectDocument; newIds: Id[] } {
  let d = doc;
  const newIds: Id[] = [];
  for (const id of ids) {
    const item = findItem(d, id);
    if (!item) continue;
    const res = nextLabel(d, item.kind === 'cabinet' ? 'cabinet' : 'panel');
    d = res.doc;
    const copy = cloneItem(item, res.label);
    const f = frameOf(item.placement);
    const o = add({ x: item.placement.x, y: item.placement.y }, scale(f.xAxis, itemWidth(item)));
    copy.placement = { ...item.placement, x: o.x, y: o.y };
    d = addItem(d, copy);
    newIds.push(copy.id);
  }
  return { doc: d, newIds };
}

/** Mirror a cabinet's handing: hinge sides, blind side, end overrides. */
export function mirrorItem(doc: ProjectDocument, id: Id): ProjectDocument {
  const flip = (s: 'left' | 'right') => (s === 'left' ? 'right' : 'left');
  return updateItem<Item>(doc, id, (i) => {
    if (i.kind !== 'cabinet') return i;
    const p = i.params;
    return {
      ...i,
      params: {
        ...p,
        hingeSide: flip(p.hingeSide),
        ends: { left: p.ends.right, right: p.ends.left },
        blind: p.blind ? { ...p.blind, side: flip(p.blind.side) } : p.blind,
        fronts: p.fronts.map((f) => (f.hinge ? { ...f, hinge: flip(f.hinge) } : f)),
      },
    };
  });
}

/** Rotate an item about its footprint centre. Detaches it from its wall. */
export function rotateItem(doc: ProjectDocument, id: Id, angle: number): ProjectDocument {
  return updateItem<Item>(doc, id, (i) => {
    const w = itemWidth(i);
    const d = i.kind === 'cabinet' ? i.params.depth : i.depth;
    const centre = localToWorld2(i.placement, { x: w / 2, y: d / 2 });
    const rotation = normalizeAngle(i.placement.rotation + angle);
    const tmp = { ...i.placement, rotation, x: 0, y: 0 };
    const c0 = localToWorld2(tmp, { x: w / 2, y: d / 2 });
    return { ...i, wallId: null, placement: { ...tmp, x: centre.x - c0.x, y: centre.y - c0.y } };
  });
}

// ───────────────────────────── Walls & openings ─────────────────────────────

export function addWall(doc: ProjectDocument, start: Vec2, end: Vec2, thickness: number, height: number): { doc: ProjectDocument; wall: Wall } {
  const wall: Wall = { id: newId('wall'), start: { ...start }, end: { ...end }, thickness, height };
  return { doc: updateRoom(doc, (r) => ({ ...r, walls: [...r.walls, wall] })), wall };
}

export function updateWall(doc: ProjectDocument, id: Id, patch: Partial<Omit<Wall, 'id'>>): ProjectDocument {
  return updateRoom(doc, (r) => ({ ...r, walls: r.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
}

/** Move a wall end and drag any wall ends joined to it. */
export function moveWallNode(doc: ProjectDocument, from: Vec2, to: Vec2): ProjectDocument {
  const near = (p: Vec2) => Math.hypot(p.x - from.x, p.y - from.y) <= 1;
  return updateRoom(doc, (r) => ({
    ...r,
    walls: r.walls.map((w) => (near(w.start) || near(w.end) ? { ...w, start: near(w.start) ? { ...to } : w.start, end: near(w.end) ? { ...to } : w.end } : w)),
  }));
}

export function removeWall(doc: ProjectDocument, id: Id): ProjectDocument {
  return updateRoom(doc, (r) => ({
    ...r,
    walls: r.walls.filter((w) => w.id !== id),
    openings: r.openings.filter((o) => o.wallId !== id),
    items: r.items.map((i) => (i.wallId === id ? { ...i, wallId: null } : i)),
  }));
}

export function addOpening(doc: ProjectDocument, opening: Omit<Opening, 'id'>): { doc: ProjectDocument; opening: Opening } {
  const o: Opening = { ...opening, id: newId('opn') };
  return { doc: updateRoom(doc, (r) => ({ ...r, openings: [...r.openings, o] })), opening: o };
}

export function updateOpening(doc: ProjectDocument, id: Id, patch: Partial<Omit<Opening, 'id'>>): ProjectDocument {
  return updateRoom(doc, (r) => ({ ...r, openings: r.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
}

export function removeOpening(doc: ProjectDocument, id: Id): ProjectDocument {
  return updateRoom(doc, (r) => ({ ...r, openings: r.openings.filter((o) => o.id !== id) }));
}

/** Replace the walls with a rectangle of clear interior size width × depth. Items are kept. */
export function setRectangularRoom(doc: ProjectDocument, width: number, depth: number, height: number, thickness: number): ProjectDocument {
  return updateRoom(doc, (r) => ({
    ...r,
    ceilingHeight: height,
    walls: rectangularWalls(width, depth, height, thickness),
    openings: [],
    items: r.items.map((i) => ({ ...i, wallId: null })),
  }));
}

export function replaceAutoTops(doc: ProjectDocument, tops: Item[]): ProjectDocument {
  return updateRoom(doc, (r) => ({ ...r, items: [...r.items.filter((i) => !(i.kind === 'panel' && i.auto)), ...tops] }));
}
