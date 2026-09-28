import Link from 'next/link';
import { History } from 'lucide-react';
import { AUDIT_FILTERS } from '@/lib/audit';
import { can, requireContext } from '@/server/context';
import { listAudit } from '@/server/queries/audit';
import { sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty';
import { NoAccess } from '@/components/no-access';
import { AuditList } from '@/components/audit/audit-list';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  if (!ctx.isOwner && !can(ctx, 'audit.view')) return <NoAccess what="the audit log" />;
  const p = await searchParams;
  const filter = sp1(p.type) ?? '';
  const { rows, nextBefore } = await listAudit(ctx, { filter, before: sp1(p.before) });
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ type: filter, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
    return `/settings/audit${q ? `?${q}` : ''}`;
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle={`Who changed what, and when${ctx.current ? ` in ${ctx.current.name}` : ' across your businesses'}. Entries can’t be edited or deleted.`} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {AUDIT_FILTERS.map((f) => (
          <Link key={f.value} href={href({ type: f.value, before: undefined })}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', filter === f.value ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:bg-surface-2')}>
            {f.label}
          </Link>
        ))}
      </div>
      <Card>
        <CardBody>
          {rows.length ? <AuditList rows={rows} tz={ctx.tz} businesses={ctx.businesses} showBusiness={!ctx.current} />
            : <EmptyState icon={<History className="size-6" />} title="Nothing here yet" body="Changes to customers, invoices, payments, automations, integrations and team access appear here automatically." />}
        </CardBody>
      </Card>
      {nextBefore || sp1(p.before) ? (
        <div className="flex justify-between text-sm">
          {sp1(p.before) ? <Link href={href({ before: undefined })} className="text-accent">← Newest</Link> : <span />}
          {nextBefore ? <Link href={href({ before: nextBefore })} className="text-accent">Older →</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
