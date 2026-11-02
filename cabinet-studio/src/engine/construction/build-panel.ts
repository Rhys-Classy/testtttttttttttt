import type { ConstructionRules, Id, MaterialDef, MaterialSlot, PanelItem } from '../model/types';
import { checkStock } from './build-cabinet';
import { box, makePart, type ItemBuild, type Part, type PartContext } from './parts';

export interface PanelBuildContext {
  rules: ConstructionRules;
  materialFor: (slot: MaterialSlot) => Id;
  materials: ReadonlyMap<Id, MaterialDef>;
}

/** Single-part products (end panels, fillers, benchtops, splashbacks). Local box [0,w]×[0,d]×[0,h]. */
export function buildPanel(panel: PanelItem, ctx: PanelBuildContext): ItemBuild {
  const { width: w, depth: d, height: h } = panel;
  const bounds = box(0, 0, 0, w, d, h);
  const bad = [w, d, h].some((v) => !Number.isFinite(v) || v <= 0);
  if (bad) {
    return { itemId: panel.id, parts: [], hardware: [], appliances: [], warnings: ['Panel sizes must be greater than zero.'], invalid: true, bounds };
  }
  const r = ctx.rules;
  const materialFor = (slot: MaterialSlot): Id => (slot === panel.materialSlot && panel.materialId ? panel.materialId : ctx.materialFor(slot));
  const pctx: PartContext = {
    itemId: panel.id,
    itemLabel: panel.label,
    materialFor,
    hasGrain: (id) => ctx.materials.get(id)?.grain ?? false,
  };
  const parts: Part[] = [];
  const fb = r.frontBanding;
  const slot = panel.materialSlot;
  switch (panel.panelType) {
    case 'end-panel':
      parts.push(
        makePart(
          { key: 'panel', role: 'end-panel', name: panel.name || 'End Panel', slot, box: bounds, thicknessAxis: 'x', lengthAxis: 'z', edges: { y0: fb, z0: fb, z1: fb } },
          pctx,
        ),
      );
      break;
    case 'filler': {
      const faceT = Math.min(r.frontThickness, d);
      parts.push(
        makePart(
          { key: 'face', role: 'filler-face', name: 'Filler', slot, box: box(0, 0, 0, w, faceT, h), thicknessAxis: 'y', lengthAxis: 'z', edges: { x0: fb, x1: fb } },
          pctx,
        ),
      );
      const t = r.carcassThickness;
      if (d > faceT + 40 && w >= t) {
        parts.push(
          makePart(
            {
              key: 'return',
              role: 'filler-return',
              name: 'Filler Return',
              slot: 'carcass',
              box: box((w - t) / 2, faceT, 0, t, Math.min(100, d - faceT), h),
              thicknessAxis: 'x',
              lengthAxis: 'z',
            },
            pctx,
          ),
        );
      }
      break;
    }
    case 'benchtop':
      parts.push(makePart({ key: 'top', role: 'benchtop', name: panel.name || 'Benchtop', slot, box: bounds, thicknessAxis: 'z', lengthAxis: 'x' }, pctx));
      break;
    case 'splashback':
      parts.push(makePart({ key: 'splash', role: 'splashback', name: panel.name || 'Splashback', slot, box: bounds, thicknessAxis: 'y', lengthAxis: 'x' }, pctx));
      break;
  }
  const warnings: string[] = [];
  checkStock(parts, ctx.materials, warnings);
  return { itemId: panel.id, parts, hardware: [], appliances: [], warnings, invalid: false, bounds };
}
