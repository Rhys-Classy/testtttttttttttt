import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { Workflow as WorkflowIcon } from 'lucide-react';
import { workflowRuns, workflows } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { relativeTime } from '@/lib/dates';
import { TRIGGERS } from '@/lib/automation/types';
import { WORKFLOW_TEMPLATES } from '@/lib/automation/templates';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

export const metadata = { title: 'Automations' };

export default async function AutomationsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'automations', b);
  if (!scope.businesses.length) return <ModuleOff label="Automations" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const rows = await readScope(ctx, (tx) => tx.select({
    w: workflows,
    active: sql<number>`(select count(*) from ${workflowRuns} r where r.workflow_id = ${workflows.id} and r.sub_account_id = ${workflows.subAccountId} and r.status in ('running','waiting'))`,
    failed: sql<number>`(select count(*) from ${workflowRuns} r where r.workflow_id = ${workflows.id} and r.sub_account_id = ${workflows.subAccountId} and r.status = 'failed' and r.finished_at > now() - interval '7 days')`,
  }).from(workflows).where(sql`${workflows.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(workflows.status), desc(workflows.updatedAt)));
  const all = !ctx.current;
  return (
    <div className="space-y-6">
      <PageHeader title="Automations" subtitle="Work that happens without you. Each automation belongs to one business." actions={<LinkButton href="/automations/new" variant="primary">New automation</LinkButton>} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/automations${qs({}, { b: id })}`} /> : null}
      {rows.length ? (
        <List>
          {rows.map(({ w, active, failed }) => (
            <ListRow key={w.id} href={`/automations/${w.id}`} icon={<WorkflowIcon className="size-5" />} title={w.name}
              meta={<>{all ? <BusinessBadge business={businessById(ctx, w.subAccountId)} /> : null}<StatusBadge status={w.status} /><span>When: {TRIGGERS.find((t) => t.type === (w.trigger as { type: string }).type)?.label}</span><span>{w.runCount} runs{w.lastRunAt ? ` · last ${relativeTime(w.lastRunAt)}` : ''}</span>{Number(failed) ? <span className="text-danger">{Number(failed)} failed this week</span> : null}</>}
              right={Number(active) ? <span className="text-xs font-normal text-muted">{Number(active)} in progress</span> : undefined} />
          ))}
        </List>
      ) : <EmptyState title="No automations yet" body="Start from a template below — they cover the jobs most businesses repeat every day." />}
      <Card>
        <CardHeader title="Start from a template" subtitle="One click, then tweak the wording" />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {WORKFLOW_TEMPLATES.map((t) => (
            <Link key={t.key} href={`/automations/new?template=${t.key}`} className="rounded-2xl border border-border p-4 hover:border-accent hover:bg-accent-soft">
              <p className="font-medium">{t.name}</p>
              <p className="mt-1 text-sm text-muted">{t.description}</p>
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
