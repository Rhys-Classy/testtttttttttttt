import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { customFieldDefinitions, forms, pipelineStages } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';

export async function builderContext(ctx: AppContext, ids: string[]) {
  return readScope({ ...ctx, scopeIds: ids }, async (tx) => {
    const fs = await tx.select({ id: forms.id, name: forms.name, b: forms.subAccountId }).from(forms).where(sql`${forms.subAccountId} = any(${pgArray(ids)})`);
    const st = await tx.selectDistinct({ name: pipelineStages.name, b: pipelineStages.subAccountId }).from(pipelineStages).where(sql`${pipelineStages.subAccountId} = any(${pgArray(ids)})`);
    const cf = await tx.select({ key: customFieldDefinitions.key, label: customFieldDefinitions.label, b: customFieldDefinitions.subAccountId }).from(customFieldDefinitions)
      .where(and(sql`${customFieldDefinitions.subAccountId} = any(${pgArray(ids)})`, eq(customFieldDefinitions.entityType, 'contact'))).orderBy(asc(customFieldDefinitions.sortOrder));
    const out: Record<string, { forms: { id: string; name: string }[]; stages: string[]; customFields: { key: string; label: string }[] }> = {};
    for (const id of ids) {
      out[id] = {
        forms: fs.filter((f) => f.b === id).map(({ id: fid, name }) => ({ id: fid, name })),
        stages: [...new Set(st.filter((s) => s.b === id).map((s) => s.name))],
        customFields: cf.filter((f) => f.b === id).map(({ key, label }) => ({ key, label })),
      };
    }
    return out;
  });
}
