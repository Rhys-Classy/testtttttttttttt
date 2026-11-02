import type { ConstructionRules, ConstructionStandard } from '../model/types';

/**
 * Default rules: Australian-style frameless (European 32 mm system) cabinetry,
 * 16 mm carcass, 18 mm fronts, 16 mm back captured between the sides, base cabinets
 * with rails under the benchtop, confirmat assembly. Values mirror common shop practice;
 * every field can be overridden per project or per cabinet.
 */
export const DEFAULT_RULES: ConstructionRules = {
  carcassThickness: 16,
  backThickness: 16,
  backMethod: 'inset',
  backGrooveDepth: 8,
  backSetback: 18,
  bottomJoint: 'between-sides',
  topJoint: 'between-sides',
  baseTopType: 'rails',
  railWidth: 100,
  housingDepth: 0,
  joinery: 'confirmat',
  fastenerSpacing: 200,
  fastenerEdgeDistance: 50,

  frontStyle: 'overlay',
  frontThickness: 18,
  frontGap: 3,
  frontRevealSide: 1.5,
  frontRevealTop: 1.5,
  frontRevealBottom: 0,
  wallFrontOverhangBottom: 0,
  maxSingleDoorWidth: 600,
  minFrontHeight: 60,

  hingeEdgeOffset: 100,
  hingeRules: [
    { maxDoorHeight: 900, count: 2 },
    { maxDoorHeight: 1600, count: 3 },
    { maxDoorHeight: 2000, count: 4 },
    { maxDoorHeight: 2600, count: 5 },
  ],

  carcassBanding: 1,
  frontBanding: 1,

  shelfFrontSetback: 20,
  shelfSideClearance: 1,
  systemHolePitch: 32,

  kickSetback: 50,
  kickThickness: 16,
  kickTopGap: 0,

  drawerBoxThickness: 16,
  drawerBottomThickness: 6,
  drawerBottomGroove: 6,
  drawerBottomRecess: 12,
  drawerHeightClearance: 40,
  drawerRearClearance: 20,
  runnerSideClearance: 12.7,
  runnerLengths: [250, 300, 350, 400, 450, 500, 550],

  finishedEnd: 'finished-side',
};

export const STANDARD_PRESETS: ConstructionStandard[] = [
  {
    id: 'std-frameless-16-inset',
    name: 'Frameless 16 mm — 16 mm inset back',
    description: '16 mm carcass, 16 mm back captured between the sides, rails on base cabinets, confirmat assembly.',
    rules: DEFAULT_RULES,
  },
  {
    id: 'std-frameless-16-groove',
    name: 'Frameless 16 mm — 3 mm grooved back',
    description: '16 mm carcass, 3 mm back in an 8 mm groove set 18 mm in from the rear edge, dowel assembly.',
    rules: { ...DEFAULT_RULES, backThickness: 3, backMethod: 'groove', joinery: 'dowel' },
  },
  {
    id: 'std-frameless-18-dado',
    name: 'Frameless 18 mm — housed, applied back',
    description: '18 mm carcass, bottoms and tops housed 6 mm into the sides, 6 mm back applied to the rear, cam fittings.',
    rules: {
      ...DEFAULT_RULES,
      carcassThickness: 18,
      backThickness: 6,
      backMethod: 'applied',
      housingDepth: 6,
      joinery: 'cam',
      baseTopType: 'full',
      drawerBoxThickness: 18,
    },
  },
];

export function cloneStandard(s: ConstructionStandard): ConstructionStandard {
  return {
    ...s,
    rules: { ...s.rules, hingeRules: s.rules.hingeRules.map((r) => ({ ...r })), runnerLengths: [...s.rules.runnerLengths] },
  };
}
