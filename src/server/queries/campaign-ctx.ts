import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { customFieldDefinitions, pipelineStages, pipelines } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';

export async function campaignOptions(ctx: AppContext, ids: string[]) {
  return readScope({ ...ctx, scopeIds: ids }, async (tx) => {
    const tags = (await tx.execute<{ b: string; t: string }>(sql`select distinct sub_account_id as b, unnest(tags) as t from contacts where sub_account_id = any(${pgArray(ids)})`)).rows;
    const pls = await tx.select().from(pipelines).where(sql`${pipelines.subAccountId} = any(${pgArray(ids)})`);
    const sts = await tx.select().from(pipelineStages).where(sql`${pipelineStages.subAccountId} = any(${pgArray(ids)})`).orderBy(asc(pipelineStages.sortOrder));
    const cfs = await tx.select().from(customFieldDefinitions).where(and(sql`${customFieldDefinitions.subAccountId} = any(${pgArray(ids)})`, eq(customFieldDefinitions.entityType, 'contact')));
    return Object.fromEntries(ids.map((id) => [id, {
      tags: tags.filter((t) => t.b === id).map((t) => t.t).sort(),
      pipelines: pls.filter((p) => p.subAccountId === id).map((p) => ({ id: p.id, name: p.name })),
      stages: sts.filter((s) => s.subAccountId === id).map((s) => ({ id: s.id, name: s.name })),
      customFields: cfs.filter((c) => c.subAccountId === id).map((c) => ({ key: c.key, label: c.label })),
    }]));
  });
}
