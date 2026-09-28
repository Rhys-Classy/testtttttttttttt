import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { FileText } from 'lucide-react';
import { contacts, quotes } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDate, relativeTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow, Tabs } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';

export const metadata = { title: 'Quotes' };

const FILTERS: Record<string, string[] | null> = { open: ['sent', 'viewed'], draft: ['draft'], accepted: ['accepted'], lost: ['rejected', 'expired'], all: null };

export default async function QuotesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const status = sp1(p.status) && sp1(p.status)! in FILTERS ? sp1(p.status)! : 'open';
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'quotes', b);
  if (!scope.businesses.length) return <ModuleOff label="Quotes" business={ctx.current?.name} />;
  const all = !ctx.current;
  const { rows, sums } = await readScope(ctx, async (tx) => {
    const base = sql`${quotes.subAccountId} = any(${pgArray(scope.ids)})`;
    const f = FILTERS[status];
    return {
      rows: await tx.select({ q: quotes, c: contacts }).from(quotes)
        .leftJoin(contacts, and(eq(contacts.id, quotes.contactId), eq(contacts.subAccountId, quotes.subAccountId)))
        .where(and(base, f ? inArray(quotes.status, f as never[]) : undefined)).orderBy(desc(quotes.createdAt)).limit(300),
      sums: await tx.select({ s: quotes.status, n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(${quotes.totalCents}),0)` }).from(quotes).where(base).groupBy(quotes.status),
    };
  });
  const cnt = (k: string[]) => sums.filter((x) => k.includes(x.s)).reduce((a, x) => a + Number(x.n), 0);
  const base = { status: status === 'open' ? undefined : status, b };
  const tabs = [
    { key: 'open', label: 'Waiting on customer', href: `/quotes${qs(base, { status: undefined })}`, count: cnt(FILTERS.open!) },
    { key: 'draft', label: 'Drafts', href: `/quotes${qs(base, { status: 'draft' })}`, count: cnt(['draft']) },
    { key: 'accepted', label: 'Accepted', href: `/quotes${qs(base, { status: 'accepted' })}`, count: cnt(['accepted']) },
    { key: 'lost', label: 'Declined / expired', href: `/quotes${qs(base, { status: 'lost' })}`, count: cnt(FILTERS.lost!) },
    { key: 'all', label: 'All', href: `/quotes${qs(base, { status: 'all' })}` },
  ];
  return (
    <div>
      <PageHeader title="Quotes" subtitle={`${formatMoney(sums.filter((x) => ['sent', 'viewed'].includes(x.s)).reduce((a, x) => a + Number(x.v), 0))} waiting on customers`} actions={<LinkButton href="/quotes/new" variant="primary">New quote</LinkButton>} />
      <Tabs tabs={tabs} active={status} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/quotes${qs(base, { b: id })}`} /> : null}
      {rows.length ? (
        <List>
          {rows.map(({ q, c }) => (
            <ListRow key={q.id} href={`/quotes/${q.id}`} icon={<FileText className="size-5" />}
              title={<>{c ? contactName(c) : 'No customer'} <span className="font-normal text-muted">· {q.number}</span></>}
              meta={<>{all ? <BusinessBadge business={businessById(ctx, q.subAccountId)} /> : null}<StatusBadge status={q.status} />
                <span>{q.sentAt ? `Sent ${relativeTime(q.sentAt)}` : `Created ${formatDate(q.createdAt, ctx.tz)}`}</span>{q.viewedAt && q.status !== 'accepted' ? <span>Viewed {relativeTime(q.viewedAt)}</span> : null}{q.title ? <span className="truncate">{q.title}</span> : null}</>}
              right={formatMoney(q.totalCents)} />
          ))}
        </List>
      ) : <EmptyState title="No quotes here" body="Type “quote Sarah $18,500 plus GST” in ⌘K, or use New quote." />}
    </div>
  );
}
