import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { customFieldDefinitions, pipelineStages, pipelines } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';

export async function formBuilderContext(ctx: AppContext, ids: string[]) {
  return readScope({ ...ctx, scopeIds: ids }, async (tx) => {
    const pls = await tx.select().from(pipelines).where(sql`${pipelines.subAccountId} = any(${pgArray(ids)})`).orderBy(asc(pipelines.sortOrder));
    const sts = await tx.select().from(pipelineStages).where(sql`${pipelineStages.subAccountId} = any(${pgArray(ids)})`).orderBy(asc(pipelineStages.sortOrder));
    const cfs = await tx.select().from(customFieldDefinitions).where(and(sql`${customFieldDefinitions.subAccountId} = any(${pgArray(ids)})`, eq(customFieldDefinitions.entityType, 'contact')));
    const pipelinesBy: Record<string, { id: string; name: string; stages: { id: string; name: string }[] }[]> = {};
    const fieldsBy: Record<string, { key: string; label: string }[]> = {};
    for (const id of ids) {
      pipelinesBy[id] = pls.filter((p) => p.subAccountId === id).map((p) => ({ id: p.id, name: p.name, stages: sts.filter((s) => s.pipelineId === p.id && s.kind === 'open').map((s) => ({ id: s.id, name: s.name })) }));
      fieldsBy[id] = cfs.filter((c) => c.subAccountId === id).map((c) => ({ key: c.key, label: c.label }));
    }
    return { pipelinesBy, fieldsBy };
  });
}
