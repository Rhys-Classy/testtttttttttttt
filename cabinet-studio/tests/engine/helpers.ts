import {
  buildCabinet,
  cabinetFromTemplate,
  DEFAULT_MATERIAL_ASSIGNMENT,
  DEFAULT_RULES,
  LIBRARY_MATERIALS,
  templateById,
  type CabinetItem,
  type ConstructionRules,
  type ItemBuild,
  type Part,
} from '@engine/index';

export const materials = new Map(LIBRARY_MATERIALS.map((m) => [m.id, m]));

export function cabinet(templateId: string, patch: Partial<CabinetItem['params']> = {}): CabinetItem {
  const t = templateById(templateId);
  if (!t) throw new Error(`no template ${templateId}`);
  const c = cabinetFromTemplate(t, 'C1');
  return { ...c, params: { ...c.params, ...patch } };
}

export function build(cab: CabinetItem, rules: Partial<ConstructionRules> = {}, ends = { left: false, right: false }): ItemBuild {
  return buildCabinet(cab, {
    rules: { ...DEFAULT_RULES, ...rules },
    materialFor: (slot) => cab.materials?.[slot] ?? DEFAULT_MATERIAL_ASSIGNMENT[slot],
    materials,
    finishedEnds: ends,
  });
}

export function part(b: ItemBuild, key: string): Part {
  const p = b.parts.find((x) => x.key === key);
  if (!p) throw new Error(`no part ${key} in [${b.parts.map((x) => x.key).join(', ')}]`);
  return p;
}

export const byRole = (b: ItemBuild, role: Part['role']) => b.parts.filter((p) => p.role === role);
