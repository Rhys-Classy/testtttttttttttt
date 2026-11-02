// Cabinet and panel library. Templates are only starting parameters — every cabinet
// placed in a room is fully parametric and can be edited into any other configuration.

import { newId } from '../model/ids';
import type {
  CabinetCategory,
  CabinetItem,
  CabinetParams,
  FrontSection,
  MaterialSlot,
  PanelItem,
  PanelType,
} from '../model/types';

type SectionDef = Omit<FrontSection, 'id'>;

export interface CabinetTemplate {
  id: string;
  name: string;
  group: string;
  category: CabinetCategory;
  description: string;
  elevation: number;
  params: Omit<CabinetParams, 'fronts'> & { fronts: SectionDef[] };
}

export interface PanelTemplate {
  id: string;
  name: string;
  group: string;
  panelType: PanelType;
  description: string;
  elevation: number;
  width: number;
  depth: number;
  height: number;
  materialSlot: MaterialSlot;
}

// Standard heights (mm): base 870 incl. 150 kick (≈905 bench with a 35 mm top),
// wall 750 with the top at 2100, tall 2100, vanity 700 wall-hung at 150.
const BASE = { height: 870, depth: 580, kickHeight: 150 };
const WALL = { height: 750, depth: 300, kickHeight: 0 };
const TALL = { height: 2100, depth: 580, kickHeight: 150 };
const COMMON = { hingeSide: 'left' as const, handle: 'bar-160' as const, ends: { left: 'auto' as const, right: 'auto' as const }, blind: null };

const doors = (shelves: number, doorCount: SectionDef['doorCount'] = 'auto', height: number | null = null): SectionDef => ({
  kind: 'doors',
  height,
  doorCount,
  shelves,
  interior: 'shelves',
});
const drawer = (height: number | null = null): SectionDef => ({ kind: 'drawer', height });
const open = (shelves: number): SectionDef => ({ kind: 'open', height: null, shelves });
const appliance = (label: string, height: number | null): SectionDef => ({ kind: 'appliance', height, appliance: label });

export const CABINET_TEMPLATES: CabinetTemplate[] = [
  // Base
  { id: 'base-1-door', name: 'Base 1 door', group: 'Base', category: 'base', description: 'Single door, one adjustable shelf.', elevation: 0, params: { ...COMMON, ...BASE, width: 450, fronts: [doors(1)] } },
  { id: 'base-2-door', name: 'Base 2 door', group: 'Base', category: 'base', description: 'Pair of doors, one adjustable shelf.', elevation: 0, params: { ...COMMON, ...BASE, width: 900, fronts: [doors(1)] } },
  { id: 'base-3-drawer', name: 'Base 3 drawer', group: 'Base', category: 'base', description: 'Shallow top drawer over two deep drawers.', elevation: 0, params: { ...COMMON, ...BASE, width: 600, fronts: [drawer(180), drawer(), drawer()] } },
  { id: 'base-4-drawer', name: 'Base 4 drawer', group: 'Base', category: 'base', description: 'Two shallow and two deep drawers.', elevation: 0, params: { ...COMMON, ...BASE, width: 600, fronts: [drawer(140), drawer(140), drawer(), drawer()] } },
  { id: 'base-door-drawer', name: 'Base drawer + door', group: 'Base', category: 'base', description: 'Top drawer over a door with one shelf.', elevation: 0, params: { ...COMMON, ...BASE, width: 600, fronts: [drawer(160), doors(1)] } },
  { id: 'base-sink', name: 'Sink base', group: 'Base', category: 'base', description: 'Pair of doors, no shelf for plumbing.', elevation: 0, params: { ...COMMON, ...BASE, width: 900, fronts: [doors(0, 2)] } },
  { id: 'base-bin', name: 'Bin pull-out', group: 'Base', category: 'base', description: 'Single full-height drawer front for a bin system.', elevation: 0, params: { ...COMMON, ...BASE, width: 450, fronts: [drawer()] } },
  { id: 'base-oven', name: 'Under-bench oven', group: 'Base', category: 'base', description: 'Oven opening over a 120 mm drawer.', elevation: 0, params: { ...COMMON, ...BASE, width: 600, fronts: [appliance('Oven', null), drawer(120)] } },
  { id: 'base-blind-corner', name: 'Blind corner base', group: 'Base', category: 'base', description: 'Door with a 450 mm blind panel for an L corner.', elevation: 0, params: { ...COMMON, ...BASE, width: 1000, fronts: [doors(1, 1)], hingeSide: 'right', blind: { side: 'left', width: 450 } } },
  { id: 'base-corner-l', name: 'Corner base (L-shape)', group: 'Base', category: 'base', description: 'L-shaped corner, 900 × 900, bi-fold doors, one L shelf.', elevation: 0, params: { ...COMMON, ...BASE, width: 900, fronts: [doors(1)], corner: { side: 'left', returnWidth: 900, doors: 'bifold' } } },
  { id: 'base-open', name: 'Open base', group: 'Base', category: 'base', description: 'Open shelving, no fronts.', elevation: 0, params: { ...COMMON, ...BASE, width: 600, fronts: [open(1)] } },

  // Wall
  { id: 'wall-1-door', name: 'Wall 1 door', group: 'Wall', category: 'wall', description: 'Single door, two shelves.', elevation: 1350, params: { ...COMMON, ...WALL, width: 450, fronts: [doors(2)] } },
  { id: 'wall-2-door', name: 'Wall 2 door', group: 'Wall', category: 'wall', description: 'Pair of doors, two shelves.', elevation: 1350, params: { ...COMMON, ...WALL, width: 900, fronts: [doors(2)] } },
  { id: 'wall-corner-l', name: 'Corner wall (L-shape)', group: 'Wall', category: 'wall', description: 'L-shaped wall corner, 600 × 600, bi-fold doors, two L shelves.', elevation: 1350, params: { ...COMMON, ...WALL, width: 600, fronts: [doors(2)], corner: { side: 'left', returnWidth: 600, doors: 'bifold' } } },
  { id: 'wall-open', name: 'Open wall shelf', group: 'Wall', category: 'wall', description: 'Open wall unit with one shelf.', elevation: 1350, params: { ...COMMON, ...WALL, width: 600, fronts: [open(1)] } },
  { id: 'wall-over-fridge', name: 'Over-fridge cabinet', group: 'Wall', category: 'wall', description: 'Full-depth pair of doors above a fridge.', elevation: 1650, params: { ...COMMON, height: 450, depth: 580, kickHeight: 0, width: 900, fronts: [doors(0, 2)] } },
  { id: 'wall-rangehood', name: 'Rangehood cabinet', group: 'Wall', category: 'wall', description: 'Wall cabinet with no shelves for an undermount rangehood.', elevation: 1350, params: { ...COMMON, ...WALL, width: 600, fronts: [doors(0)] } },

  // Tall
  { id: 'tall-pantry', name: 'Pantry', group: 'Tall', category: 'tall', description: 'Upper and lower doors, five shelves.', elevation: 0, params: { ...COMMON, ...TALL, width: 600, fronts: [doors(1, 'auto', 520), doors(4)] } },
  { id: 'tall-pantry-wide', name: 'Pantry 900', group: 'Tall', category: 'tall', description: 'Wide pantry with door pairs.', elevation: 0, params: { ...COMMON, ...TALL, width: 900, fronts: [doors(1, 2, 520), doors(4, 2)] } },
  { id: 'tall-oven', name: 'Oven tower', group: 'Tall', category: 'tall', description: 'Door over an oven opening over two drawers.', elevation: 0, params: { ...COMMON, ...TALL, width: 600, fronts: [doors(1), appliance('Oven', 595), drawer(300), drawer(300)] } },
  { id: 'tall-oven-microwave', name: 'Oven + microwave tower', group: 'Tall', category: 'tall', description: 'Microwave and oven openings with a drawer below.', elevation: 0, params: { ...COMMON, ...TALL, width: 600, fronts: [doors(1), appliance('Microwave', 380), appliance('Oven', 595), drawer(300)] } },
  { id: 'tall-broom', name: 'Broom / utility', group: 'Tall', category: 'tall', description: 'Full-height door with one high shelf.', elevation: 0, params: { ...COMMON, ...TALL, width: 450, fronts: [doors(1)] } },

  // Vanity & laundry
  { id: 'vanity-2-drawer', name: 'Vanity 2 drawer', group: 'Vanity & laundry', category: 'vanity', description: 'Wall-hung vanity with two drawers.', elevation: 150, params: { ...COMMON, height: 700, depth: 460, kickHeight: 0, width: 900, fronts: [drawer(), drawer()], handle: 'none' } },
  { id: 'vanity-door', name: 'Vanity door', group: 'Vanity & laundry', category: 'vanity', description: 'Wall-hung vanity with doors.', elevation: 150, params: { ...COMMON, height: 700, depth: 460, kickHeight: 0, width: 600, fronts: [doors(0)] } },
  { id: 'laundry-tub', name: 'Laundry tub base', group: 'Vanity & laundry', category: 'laundry', description: 'Doors under a laundry tub, no shelf.', elevation: 0, params: { ...COMMON, ...BASE, width: 700, fronts: [doors(0, 2)] } },
  { id: 'laundry-tall', name: 'Laundry tall', group: 'Vanity & laundry', category: 'laundry', description: 'Tall storage with four shelves.', elevation: 0, params: { ...COMMON, ...TALL, width: 600, fronts: [doors(4)] } },

  // Wardrobes & furniture
  { id: 'wardrobe-hanging', name: 'Wardrobe hanging', group: 'Wardrobe & furniture', category: 'wardrobe', description: 'Pair of doors, top shelf and hanging rail.', elevation: 0, params: { ...COMMON, height: 2100, depth: 580, kickHeight: 100, width: 900, fronts: [{ kind: 'doors', height: null, doorCount: 2, interior: 'hanging' }] } },
  { id: 'wardrobe-drawers', name: 'Wardrobe + drawers', group: 'Wardrobe & furniture', category: 'wardrobe', description: 'Hanging over two drawers.', elevation: 0, params: { ...COMMON, height: 2100, depth: 580, kickHeight: 100, width: 900, fronts: [{ kind: 'doors', height: null, doorCount: 2, interior: 'hanging' }, drawer(240), drawer(240)] } },
  { id: 'furniture-bookcase', name: 'Bookcase', group: 'Wardrobe & furniture', category: 'furniture', description: 'Open shelving unit, four shelves.', elevation: 0, params: { ...COMMON, height: 1800, depth: 350, kickHeight: 60, width: 800, fronts: [open(4)] } },
  { id: 'custom-blank', name: 'Custom carcass', group: 'Wardrobe & furniture', category: 'furniture', description: 'Empty carcass to configure from scratch.', elevation: 0, params: { ...COMMON, height: 870, depth: 580, kickHeight: 150, width: 600, fronts: [open(0)] } },
];

export const PANEL_TEMPLATES: PanelTemplate[] = [
  { id: 'panel-end-base', name: 'Base end panel', group: 'Panels & tops', panelType: 'end-panel', description: '18 mm end panel, floor to bench.', elevation: 0, width: 18, depth: 598, height: 870, materialSlot: 'panel' },
  { id: 'panel-end-wall', name: 'Wall end panel', group: 'Panels & tops', panelType: 'end-panel', description: '18 mm end panel for wall cabinets.', elevation: 1350, width: 18, depth: 318, height: 750, materialSlot: 'panel' },
  { id: 'panel-end-tall', name: 'Tall end panel', group: 'Panels & tops', panelType: 'end-panel', description: '18 mm end panel, floor to 2100.', elevation: 0, width: 18, depth: 598, height: 2100, materialSlot: 'panel' },
  { id: 'filler-base', name: 'Base filler', group: 'Panels & tops', panelType: 'filler', description: 'Face filler flush with doors, with return.', elevation: 150, width: 50, depth: 598, height: 720, materialSlot: 'panel' },
  { id: 'filler-wall', name: 'Wall filler', group: 'Panels & tops', panelType: 'filler', description: 'Face filler for wall cabinets.', elevation: 1350, width: 50, depth: 318, height: 750, materialSlot: 'panel' },
  { id: 'filler-tall', name: 'Tall filler', group: 'Panels & tops', panelType: 'filler', description: 'Face filler for tall cabinets.', elevation: 150, width: 50, depth: 598, height: 1950, materialSlot: 'panel' },
  { id: 'benchtop', name: 'Benchtop', group: 'Panels & tops', panelType: 'benchtop', description: '20 mm stone benchtop slab.', elevation: 870, width: 1200, depth: 620, height: 20, materialSlot: 'benchtop' },
  { id: 'splashback', name: 'Splashback', group: 'Panels & tops', panelType: 'splashback', description: '6 mm glass splashback.', elevation: 890, width: 1200, depth: 6, height: 600, materialSlot: 'splashback' },
];

export const templateById = (id: string): CabinetTemplate | undefined => CABINET_TEMPLATES.find((t) => t.id === id);
export const panelTemplateById = (id: string): PanelTemplate | undefined => PANEL_TEMPLATES.find((t) => t.id === id);

export function sectionsFrom(defs: SectionDef[]): FrontSection[] {
  return defs.map((d) => ({ ...d, id: newId('fs') }));
}

export function cabinetFromTemplate(t: CabinetTemplate, label: string): CabinetItem {
  const { fronts, ends, blind, corner, ...rest } = t.params;
  return {
    kind: 'cabinet',
    id: newId('cab'),
    label,
    name: t.name,
    templateId: t.id,
    category: t.category,
    placement: { x: 0, y: 0, rotation: 0, elevation: t.elevation },
    wallId: null,
    params: { ...rest, ends: { ...ends }, blind: blind ? { ...blind } : null, corner: corner ? { ...corner } : null, fronts: sectionsFrom(fronts) },
  };
}

export function panelFromTemplate(t: PanelTemplate, label: string): PanelItem {
  return {
    kind: 'panel',
    id: newId('pnl'),
    label,
    name: t.name,
    panelType: t.panelType,
    width: t.width,
    depth: t.depth,
    height: t.height,
    materialSlot: t.materialSlot,
    materialId: null,
    placement: { x: 0, y: 0, rotation: 0, elevation: t.elevation },
    wallId: null,
  };
}
