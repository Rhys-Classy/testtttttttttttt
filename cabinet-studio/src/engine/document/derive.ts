// Derived data for a room: wall geometry, resolved ends and the construction of every
// item. Results are memoised per item so that editing one cabinet rebuilds one cabinet.

import { buildCabinet } from '../construction/build-cabinet';
import { buildPanel } from '../construction/build-panel';
import type { ItemBuild } from '../construction/parts';
import { resolveEnds, type EndState } from '../layout/adjacency';
import { itemExtents, type Extents } from '../layout/extents';
import type { SnapObstacle } from '../layout/snapping';
import type { ConstructionRules, ConstructionStandard, Id, Item, MaterialAssignment, MaterialDef, MaterialSlot, ProjectDocument, Room } from '../model/types';
import { allFaces, computeWalls, roomLoop, type WallFace, type WallGeometry } from '../room/walls';
import { activeRoom } from './commands';

export interface DerivedRoom {
  room: Room;
  walls: Map<string, WallGeometry>;
  faces: WallFace[];
  interiorFaceIds: Set<string>;
  floorPolygon: { x: number; y: number }[] | null;
  ends: Map<string, EndState>;
  builds: Map<string, ItemBuild>;
  materials: Map<Id, MaterialDef>;
}

interface CacheEntry {
  item: Item;
  rules: ConstructionRules;
  defaults: MaterialAssignment;
  materials: MaterialDef[];
  left: boolean;
  right: boolean;
  build: ItemBuild;
}

export class Deriver {
  private builds = new Map<string, CacheEntry>();
  private rulesCache = new WeakMap<ConstructionStandard, WeakMap<object, ConstructionRules>>();
  private materialsKey: MaterialDef[] | null = null;
  private materialsMap = new Map<Id, MaterialDef>();
  private wallsKey: Room['walls'] | null = null;
  private wallsValue: { walls: Map<string, WallGeometry>; faces: WallFace[]; loop: ReturnType<typeof roomLoop> } | null = null;

  rulesFor(doc: ProjectDocument, item: Item): ConstructionRules {
    const id = item.kind === 'cabinet' ? (item.standardId ?? doc.defaultStandardId) : doc.defaultStandardId;
    const std = doc.standards.find((s) => s.id === id) ?? doc.standards.find((s) => s.id === doc.defaultStandardId) ?? doc.standards[0];
    const overrides = item.kind === 'cabinet' ? item.overrides : undefined;
    if (!overrides || Object.keys(overrides).length === 0) return std.rules;
    let perStd = this.rulesCache.get(std);
    if (!perStd) this.rulesCache.set(std, (perStd = new WeakMap()));
    let r = perStd.get(overrides);
    if (!r) perStd.set(overrides, (r = { ...std.rules, ...overrides }));
    return r;
  }

  materialMap(doc: ProjectDocument): Map<Id, MaterialDef> {
    if (this.materialsKey !== doc.materials) {
      this.materialsKey = doc.materials;
      this.materialsMap = new Map(doc.materials.map((m) => [m.id, m]));
    }
    return this.materialsMap;
  }

  private wallData(room: Room) {
    if (this.wallsKey !== room.walls || !this.wallsValue) {
      const walls = computeWalls(room.walls);
      this.wallsKey = room.walls;
      this.wallsValue = { walls, faces: allFaces(walls), loop: roomLoop(room.walls) };
    }
    return this.wallsValue;
  }

  extents(doc: ProjectDocument, item: Item): Extents {
    const r = this.rulesFor(doc, item);
    return itemExtents(item, r.frontStyle === 'overlay' ? r.frontThickness : 0);
  }

  obstacles(doc: ProjectDocument, room: Room, exclude: Set<Id>): SnapObstacle[] {
    return room.items.filter((i) => !exclude.has(i.id)).map((i) => ({ id: i.id, placement: i.placement, extents: this.extents(doc, i) }));
  }

  derive(doc: ProjectDocument, room: Room = activeRoom(doc)): DerivedRoom {
    const materials = this.materialMap(doc);
    const { walls, faces, loop } = this.wallData(room);
    const ends = resolveEnds(room, walls);
    const builds = new Map<string, ItemBuild>();
    const live = new Set<string>();
    for (const item of room.items) {
      live.add(item.id);
      const rules = this.rulesFor(doc, item);
      const e = ends.get(item.id);
      const left = e?.left ?? false;
      const right = e?.right ?? false;
      const cached = this.builds.get(item.id);
      if (
        cached &&
        cached.item === item &&
        cached.rules === rules &&
        cached.defaults === doc.materialDefaults &&
        cached.materials === doc.materials &&
        cached.left === left &&
        cached.right === right
      ) {
        builds.set(item.id, cached.build);
        continue;
      }
      const materialFor = (slot: MaterialSlot): Id =>
        (item.kind === 'cabinet' ? item.materials?.[slot] : undefined) ?? doc.materialDefaults[slot];
      const build =
        item.kind === 'cabinet'
          ? buildCabinet(item, { rules, materialFor, materials, finishedEnds: { left, right } })
          : buildPanel(item, { rules, materialFor, materials });
      this.builds.set(item.id, { item, rules, defaults: doc.materialDefaults, materials: doc.materials, left, right, build });
      builds.set(item.id, build);
    }
    for (const id of [...this.builds.keys()]) if (!live.has(id)) this.builds.delete(id);
    return {
      room,
      walls,
      faces,
      interiorFaceIds: loop?.interiorFaceIds ?? new Set(),
      floorPolygon: loop?.polygon ?? null,
      ends,
      builds,
      materials,
    };
  }
}
