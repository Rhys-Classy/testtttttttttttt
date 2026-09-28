import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { contacts, workflowRuns, workflows } from '@/db/schema';
import { isUuid } from '@/db/context';
import { formatDateTime } from '@/lib/dates';
import type { Step, Trigger } from '@/lib/automation/types';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { builderContext } from '@/server/queries/automation-ctx';
import { deleteWorkflowAction } from '@/server/actions/marketing';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { WorkflowBuilder } from '../builder';

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, async (tx) => {
    const [w] = await tx.select().from(workflows).where(eq(workflows.id, id));
    if (!w) return null;
    const runs = await tx.select({ r: workflowRuns, c: contacts }).from(workflowRuns)
      .leftJoin(contacts, and(eq(contacts.id, workflowRuns.contactId), eq(contacts.subAccountId, workflowRuns.subAccountId)))
      .where(and(eq(workflowRuns.subAccountId, w.subAccountId), eq(workflowRuns.workflowId, w.id))).orderBy(desc(workflowRuns.startedAt)).limit(25);
    return { w, runs };
  });
  if (!d) notFound();
  const { w } = d;
  const biz = businessById(ctx, w.subAccountId)!;
  const ctxBy = await builderContext(ctx, [w.subAccountId]);
  return (
    <div className="space-y-6">
      <PageHeader title={w.name} subtitle={<span className="flex items-center gap-2"><BusinessBadge business={biz} full /><StatusBadge status={w.status} /></span>}
        actions={<form action={deleteWorkflowAction.bind(null, w.subAccountId, w.id)}><button className="text-sm text-muted hover:text-danger">Delete</button></form>} />
      <WorkflowBuilder businesses={[{ id: biz.id, name: biz.name }]} ctxByBusiness={ctxBy}
        initial={{ id: w.id, subAccountId: w.subAccountId, name: w.name, description: w.description ?? undefined, trigger: w.trigger as unknown as Trigger, steps: w.steps as Step[], settings: w.settings, status: w.status }} />
      <Card>
        <CardHeader title="Recent runs" subtitle={`${w.runCount} total`} />
        <CardBody className="space-y-2">
          {d.runs.length ? d.runs.map(({ r, c }) => (
            <details key={r.id} className="rounded-xl border border-border px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={r.status} />
                {c ? <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">{contactName(c)}</Link> : <span className="text-muted">No contact</span>}
                <span className="text-xs text-muted">{formatDateTime(r.startedAt, ctx.tz)}{r.nextRunAt && r.status === 'waiting' ? ` · next step ${formatDateTime(r.nextRunAt, ctx.tz)}` : ''}</span>
                {r.error ? <span className="text-xs text-danger">{r.error}</span> : null}
              </summary>
              <ol className="mt-2 space-y-1 text-xs text-muted">
                {r.log.map((l, i) => <li key={i}>{l.ok ? '✓' : '✗'} {l.type}{l.message ? ` — ${l.message}` : ''} <span className="opacity-60">{formatDateTime(l.at, ctx.tz)}</span></li>)}
              </ol>
            </details>
          )) : <p className="text-sm text-muted">No runs yet. Turn it on and it will run when the trigger happens.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
