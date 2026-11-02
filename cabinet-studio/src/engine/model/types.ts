// The project document: the single source of truth that is saved to disk.
// Everything the user sees (3D, plans, elevations, cutlists) is derived from it.
// Plain JSON-serialisable data only. All lengths in millimetres, angles in radians.

import type { Placement } from '../math/placement';
import type { Vec2 } from '../math/vec';

export type Id = string;

// ───────────────────────────── Materials ─────────────────────────────

export type MaterialCategory =
  | 'melamine'
  | 'laminate'
  | 'veneer'
  | 'solid-timber'
  | 'mdf'
  | 'plywood'
  | 'board'
  | 'stone'
  | 'engineered-stone'
  | 'glass'
  | 'aluminium'
  | 'stainless'
  | 'paint'
  | 'wall'
  | 'floor'
  | 'custom';

export type AppearanceKind = 'solid' | 'wood' | 'stone' | 'metal' | 'glass' | 'tiles' | 'image';

export interface MaterialAppearance {
  kind: AppearanceKind;
  /** Base colour, sRGB hex. */
  color: string;
  /** Secondary colour (grain, veining, grout). */
  color2?: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  /** 0–1. Only used by glass. */
  transmission?: number;
  opacity?: number;
  /** Real-world size of one texture repeat, mm. */
  textureScale?: number;
  /** Data URL of an imported image texture (appearance.kind === 'image'). */
  imageDataUrl?: string;
  /** Deterministic seed for procedural textures. */
  seed?: number;
}

export interface MaterialDef {
  id: Id;
  name: string;
  category: MaterialCategory;
  supplier?: string;
  code?: string;
  /** Board thicknesses this material is stocked in (mm). Empty = any (e.g. paint). */
  thicknesses: number[];
  /** Raw sheet size for nesting, mm. Null for non-sheet materials. */
  sheet: { length: number; width: number } | null;
  /** Whether the grain direction matters for cutting/nesting. */
  grain: boolean;
  appearance: MaterialAppearance;
}

/** Which material each family of parts uses. */
export type MaterialSlot =
  | 'carcass'
  | 'front'
  | 'back'
  | 'drawerBox'
  | 'drawerBottom'
  | 'kick'
  | 'panel'
  | 'benchtop'
  | 'splashback'
  | 'handle';

export type MaterialAssignment = Record<MaterialSlot, Id>;

// ───────────────────────────── Construction ─────────────────────────────

export type BackMethod = 'inset' | 'groove' | 'applied';
/** 'between-sides': the panel sits between the sides. 'full-width': the panel runs the full width and the sides sit on/under it. */
export type HorizontalJoint = 'between-sides' | 'full-width';
export type JoineryMethod = 'confirmat' | 'dowel' | 'cam' | 'rafix' | 'screw' | 'butt-glue';
export type FrontStyle = 'overlay' | 'inset';

export interface HingeRule {
  /** Applies to doors up to this height (mm). */
  maxDoorHeight: number;
  count: number;
}

/**
 * Construction rules: how a cabinet is turned into manufacturing parts.
 * Every number here is data, not code — shops can create their own standards.
 */
export interface ConstructionRules {
  carcassThickness: number;
  backThickness: number;
  backMethod: BackMethod;
  /** Depth of the back groove (groove method). */
  backGrooveDepth: number;
  /** Distance from the rear edge of the sides to the rear face of the back (groove method). */
  backSetback: number;
  /** How the bottom meets the sides. */
  bottomJoint: HorizontalJoint;
  /** How the top meets the sides. */
  topJoint: HorizontalJoint;
  /** Base cabinets: full top panel, or front and back rails (benchtop sits on rails). */
  baseTopType: 'rails' | 'full';
  railWidth: number;
  /** Housing (dado) depth for bottoms, tops and fixed shelves; 0 = butt joint. */
  housingDepth: number;
  joinery: JoineryMethod;
  /** Max spacing between fasteners along a joint. */
  fastenerSpacing: number;
  /** Distance of the first/last fastener from the joint ends. */
  fastenerEdgeDistance: number;

  frontStyle: FrontStyle;
  frontThickness: number;
  /** Gap between adjacent fronts (and to neighbouring cabinets' fronts). */
  frontGap: number;
  /** Reveal at the left/right edge of the front zone (usually frontGap / 2). */
  frontRevealSide: number;
  /** Reveal at the top of the front zone. Negative values make fronts overhang. */
  frontRevealTop: number;
  /** Reveal at the bottom of the front zone. Negative values make fronts overhang (finger lip). */
  frontRevealBottom: number;
  /** Wall cabinet front overhang below the carcass (finger pull lip), mm. */
  wallFrontOverhangBottom: number;
  maxSingleDoorWidth: number;
  /** Smallest front the generator will allow. */
  minFrontHeight: number;

  hingeEdgeOffset: number;
  hingeRules: HingeRule[];

  /** Edge banding on exposed carcass edges. */
  carcassBanding: number;
  /** Edge banding on fronts. */
  frontBanding: number;

  shelfFrontSetback: number;
  shelfSideClearance: number;
  /** 32 mm system line-bore pitch for adjustable shelf positions; 0 disables snapping. */
  systemHolePitch: number;

  kickSetback: number;
  kickThickness: number;
  /** Gap between the top of the kickboard and the carcass bottom. */
  kickTopGap: number;

  drawerBoxThickness: number;
  drawerBottomThickness: number;
  drawerBottomGroove: number;
  drawerBottomRecess: number;
  /** Front height minus this = drawer box height (before fitting checks). */
  drawerHeightClearance: number;
  drawerRearClearance: number;
  /** Runner clearance per side between the box and the carcass side. */
  runnerSideClearance: number;
  /** Available runner lengths, mm. */
  runnerLengths: number[];

  /** How an exposed end is made. */
  finishedEnd: 'finished-side';
}

export interface ConstructionStandard {
  id: Id;
  name: string;
  description: string;
  rules: ConstructionRules;
}

// ───────────────────────────── Cabinets ─────────────────────────────

export type CabinetCategory =
  | 'base'
  | 'wall'
  | 'tall'
  | 'vanity'
  | 'laundry'
  | 'wardrobe'
  | 'furniture';

export type FrontKind = 'doors' | 'drawer' | 'open' | 'appliance';
export type HingeSide = 'left' | 'right';
export type EndMode = 'auto' | 'finished' | 'unfinished';
export type InteriorKind = 'shelves' | 'hanging';

/** One horizontal band of the cabinet front, listed top to bottom. */
export interface FrontSection {
  id: Id;
  kind: FrontKind;
  /** Visible front height in mm; null shares the remaining height equally. */
  height: number | null;
  /** Doors only: 'auto' picks 1 or 2 from the zone width. */
  doorCount?: 'auto' | 1 | 2;
  /** Doors only: overrides the cabinet hinge side for single doors. */
  hinge?: HingeSide;
  /** Adjustable shelves behind this section (doors/open). */
  shelves?: number;
  interior?: InteriorKind;
  /** Appliance only: label shown in drawings and schedules. */
  appliance?: string;
}

export type HandleStyle = 'bar-128' | 'bar-160' | 'bar-192' | 'bar-320' | 'knob' | 'none';

export interface BlindSpec {
  side: 'left' | 'right';
  /** Width of the blind (non-opening) part of the front, from the cabinet edge. */
  width: number;
}

/** Door / drawer front profile. Manufacturing detail goes on the part comment. */
export type FrontProfile = 'slab' | 'shaker' | 'v-groove' | 'j-pull';

/**
 * L-shaped corner cabinet. The cabinet's width runs along the back wall and
 * `returnWidth` along the side wall; `depth` is the depth of both wings.
 * 'left' sits in the corner on the viewer's left when facing the back wall.
 */
export interface CornerSpec {
  side: 'left' | 'right';
  returnWidth: number;
  doors: 'bifold' | 'separate';
}

/** Manual adjustments to one door or drawer front, keyed by its front key. */
export interface FrontOverride {
  hinge?: HingeSide;
  handle?: HandleStyle;
  profile?: FrontProfile;
  materialId?: Id;
  /** Extend (+) or reduce (−) each edge, mm. */
  trim?: { left?: number; right?: number; top?: number; bottom?: number };
}

export interface CabinetParams {
  width: number;
  height: number;
  depth: number;
  /** Plinth / kick height below the carcass. 0 for wall cabinets. */
  kickHeight: number;
  fronts: FrontSection[];
  hingeSide: HingeSide;
  handle: HandleStyle;
  ends: { left: EndMode; right: EndMode };
  blind?: BlindSpec | null;
  /** Front profile for every door and drawer front (default slab). */
  profile?: FrontProfile;
  corner?: CornerSpec | null;
}

export type LayerId = 'walls' | 'openings' | 'base' | 'wall' | 'tall' | 'panels' | 'tops' | 'dimensions';

interface ItemBase {
  id: Id;
  /** Short reference used on drawings and cutlists, e.g. "C3", "P1". */
  label: string;
  placement: Placement;
  /** Wall the item was snapped to, if any (informational; geometry is in placement). */
  wallId?: Id | null;
}

export interface CabinetItem extends ItemBase {
  kind: 'cabinet';
  templateId: Id;
  name: string;
  category: CabinetCategory;
  params: CabinetParams;
  /** Construction standard override; defaults to the project's. */
  standardId?: Id | null;
  /** Per-cabinet rule overrides on top of the standard. */
  overrides?: Partial<ConstructionRules>;
  /** Per-cabinet material overrides. */
  materials?: Partial<MaterialAssignment>;
  /** Individual door / drawer front adjustments, keyed by front key (see Part.frontKey). */
  frontOverrides?: Record<string, FrontOverride>;
}

export type PanelType = 'end-panel' | 'filler' | 'benchtop' | 'splashback';

/** Single-part products: end panels, fillers, benchtops, splashbacks. Local box [0,w]×[0,d]×[0,h]. */
export interface PanelItem extends ItemBase {
  kind: 'panel';
  panelType: PanelType;
  name: string;
  width: number;
  depth: number;
  height: number;
  materialSlot: MaterialSlot;
  materialId?: Id | null;
  /** Generated by "Auto benchtops" — replaced on regeneration. */
  auto?: boolean;
}

export type Item = CabinetItem | PanelItem;

// ───────────────────────────── Room ─────────────────────────────

export interface Wall {
  id: Id;
  /** Centre-line start/end in plan. */
  start: Vec2;
  end: Vec2;
  thickness: number;
  height: number;
}

export type OpeningKind = 'window' | 'door';

export interface Opening {
  id: Id;
  wallId: Id;
  kind: OpeningKind;
  /** Distance along the wall centre line from wall.start to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Height of the opening's bottom above the floor (0 for doors). */
  sill: number;
}

export interface Room {
  id: Id;
  name: string;
  ceilingHeight: number;
  walls: Wall[];
  openings: Opening[];
  items: Item[];
  floorMaterialId: Id;
  wallMaterialId: Id;
}

// ───────────────────────────── Presentation ─────────────────────────────

export type LightingPreset = 'studio' | 'daylight' | 'evening';
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface RenderSettings {
  lighting: LightingPreset;
  exposure: number;
  /** Sun direction, degrees. */
  sunAzimuth: number;
  sunElevation: number;
  sunIntensity: number;
  underCabinetLights: boolean;
}

export interface SavedCamera {
  id: Id;
  name: string;
  /** World position and target in mm (plan x, plan y, height z). */
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
}

export interface ClientInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export interface ProjectDocument {
  id: Id;
  name: string;
  client: ClientInfo;
  notes: string;
  createdAt: string;
  updatedAt: string;
  rooms: Room[];
  activeRoomId: Id;
  standards: ConstructionStandard[];
  defaultStandardId: Id;
  materials: MaterialDef[];
  materialDefaults: MaterialAssignment;
  render: RenderSettings;
  cameras: SavedCamera[];
  /** Monotonic counters for human-readable labels. */
  counters: { cabinet: number; panel: number };
}
