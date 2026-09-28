import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { contacts, deals, pipelineStages, pipelines } from '@/db/schema';
import { readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui/page';
import { BusinessFilter } from '@/components/business-filter';
import { ModuleOff } from '@/components/module-off';
import { AddButton } from '@/components/add-button';
import { Board } from './board';

export const metadata = { title: 'Pipeline' };

export default async function PipelinePage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'sales');
  if (!scope.businesses.length) return <ModuleOff label="Pipeline" business={ctx.current?.name} noAccess={scope.noAccess} />;
  // Pipelines belong to one business; in All view pick which one to look at.
  const bizId = ctx.current?.id ?? (sp1(p.b) && scope.businesses.some((b) => b.id === sp1(p.b)) ? sp1(p.b)! : scope.businesses[0].id);
  const view = sp1(p.view) === 'list' ? 'list' : 'board';
  const highlight = sp1(p.deal);

  const data = await readScope({ ...ctx, scopeIds: [bizId] }, async (tx) => {
    const pls = await tx.select().from(pipelines).where(eq(pipelines.subAccountId, bizId)).orderBy(desc(pipelines.isDefault), asc(pipelines.sortOrder));
    const pipeline = pls.find((x) => x.id === sp1(p.pipeline)) ?? pls[0];
    if (!pipeline) return null;
    const stages = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.subAccountId, bizId), eq(pipelineStages.pipelineId, pipeline.id))).orderBy(asc(pipelineStages.sortOrder));
    const rows = await tx.select({ d: deals, c: contacts }).from(deals)
      .leftJoin(contacts, and(eq(contacts.id, deals.contactId), eq(contacts.subAccountId, deals.subAccountId)))
      .where(and(eq(deals.subAccountId, bizId), eq(deals.pipelineId, pipeline.id))).orderBy(desc(deals.updatedAt)).limit(500);
    return { pls, pipeline, stages, rows };
  });
  if (!data) return <p>No pipeline yet.</p>;
  const openValue = data.rows.filter((r) => r.d.status === 'open').reduce((s, r) => s + r.d.valueCents, 0);
  const weighted = data.rows.filter((r) => r.d.status === 'open').reduce((s, r) => s + (r.d.valueCents * (r.d.probability ?? 0)) / 100, 0);
  const base = { b: ctx.current ? undefined : bizId, view: view === 'list' ? 'list' : undefined, pipeline: sp1(p.pipeline) };
  const now = Date.now();

  return (
    <div>
      <PageHeader title="Pipeline" subtitle={`${formatMoney(openValue)} open · ${formatMoney(Math.round(weighted))} weighted`}
        actions={<>
          <div className="flex rounded-xl border border-border bg-surface p-1 text-sm">
            <Link href={`/pipeline${qs(base, { view: undefined })}`} className={`rounded-lg px-3 py-1.5 ${view === 'board' ? 'bg-surface-2 font-medium' : 'text-muted'}`}>Board</Link>
            <Link href={`/pipeline${qs(base, { view: 'list' })}`} className={`rounded-lg px-3 py-1.5 ${view === 'list' ? 'bg-surface-2 font-medium' : 'text-muted'}`}>List</Link>
          </div>
          <AddButton kind="deal" label="Add deal" />
        </>} />
      {!ctx.current ? <BusinessFilter businesses={scope.businesses} active={bizId} hrefFor={(id) => `/pipeline${qs(base, { b: id ?? scope.businesses[0].id, pipeline: undefined })}`} /> : null}
      {data.pls.length > 1 ? (
        <div className="mb-3 flex gap-2 text-sm">{data.pls.map((pl) => <Link key={pl.id} href={`/pipeline${qs(base, { pipeline: pl.id })}`} className={`rounded-full border px-3 py-1 ${pl.id === data.pipeline.id ? 'border-text font-medium' : 'border-border text-muted'}`}>{pl.name}</Link>)}</div>
      ) : null}
      <Board view={view} stages={data.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        deals={data.rows.map(({ d, c }) => ({
          id: d.id, subAccountId: d.subAccountId, stageId: d.stageId, title: d.title, contact: c ? contactName(c) : null, contactId: d.contactId,
          valueCents: d.valueCents, daysInStage: Math.floor((now - (d.stageChangedAt ?? d.createdAt).getTime()) / 86_400_000), highlight: d.id === highlight,
        }))} />
    </div>
  );
}
