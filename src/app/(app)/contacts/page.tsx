import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { Building2, Search } from 'lucide-react';
import { companies, contacts } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { relativeTime } from '@/lib/dates';
import { can, businessById, label, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { qs, sp1, type SP, pageOf, splitPage } from '@/server/page-helpers';
import { Pager } from '@/components/ui/pager';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow, Tabs } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { AddButton } from '@/components/add-button';

import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Contacts' };

export default async function ContactsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  if (!can(ctx, 'contacts.view')) return <NoAccess what="customers" />;
  const p = await searchParams;
  const q = sp1(p.q)?.trim();
  const status = sp1(p.status);
  const tag = sp1(p.tag);
  const b = sp1(p.b);
  const tab = sp1(p.tab) ?? 'people';
  const company = sp1(p.company);
  const ids = b && ctx.scopeIds.includes(b) ? [b] : ctx.scopeIds;
  const all = !ctx.current;
  const plural = label(ctx, 'contacts', 'Contacts');

  const pg = pageOf(p);
  const data = await readScope(ctx, async (tx) => {
    const conds = [sql`${contacts.subAccountId} = any(${pgArray(ids)})`, isNull(contacts.archivedAt)];
    if (q) {
      const like = `%${q.replace(/\s+/g, '%')}%`;
      conds.push(or(ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, like), ilike(contacts.email, like), ilike(contacts.phone, `%${q.replace(/\D/g, '').slice(-8) || q}%`))!);
    }
    if (status) conds.push(eq(contacts.status, status as never));
    if (tag) conds.push(sql`${tag} = any(${contacts.tags})`);
    if (company) conds.push(eq(contacts.companyId, company));
    const people = tab === 'people' ? await tx.select({ c: contacts, co: companies }).from(contacts)
      .leftJoin(companies, and(eq(companies.id, contacts.companyId), eq(companies.subAccountId, contacts.subAccountId)))
      .where(and(...conds)).orderBy(desc(contacts.updatedAt), desc(contacts.id)).limit(pg.limit).offset(pg.offset) : [];
    const counts = await tx.select({ status: contacts.status, n: sql<number>`count(*)` }).from(contacts)
      .where(and(sql`${contacts.subAccountId} = any(${pgArray(ids)})`, isNull(contacts.archivedAt))).groupBy(contacts.status);
    const cos = tab === 'companies' ? await tx.select({ co: companies, n: sql<number>`(select count(*) from contacts c where c.company_id = ${companies.id} and c.sub_account_id = ${companies.subAccountId})` })
      .from(companies).where(and(sql`${companies.subAccountId} = any(${pgArray(ids)})`, q ? ilike(companies.name, `%${q}%`) : undefined)).orderBy(companies.name).limit(200) : [];
    const tags = await tx.execute<{ tag: string; n: number }>(sql`select t as tag, count(*) as n from contacts, unnest(tags) t where sub_account_id = any(${pgArray(ids)}) and archived_at is null group by t order by n desc limit 12`);
    return { ...splitPage(people), counts, cos, tags: tags.rows };
  });
  const people = data.rows;
  const hasNext = data.hasNext;

  const count = (s: string) => Number(data.counts.find((c) => c.status === s)?.n ?? 0);
  const total = data.counts.reduce((a, c) => a + Number(c.n), 0);
  const base = { q, status, tag, b, tab: tab === 'people' ? undefined : tab };
  const tabs = [
    { key: 'all', label: 'Everyone', href: `/contacts${qs(base, { status: undefined, tab: undefined })}`, count: total },
    { key: 'lead', label: 'Leads', href: `/contacts${qs(base, { status: 'lead', tab: undefined })}`, count: count('lead') },
    { key: 'customer', label: 'Customers', href: `/contacts${qs(base, { status: 'customer', tab: undefined })}`, count: count('customer') },
    { key: 'inactive', label: 'Inactive', href: `/contacts${qs(base, { status: 'inactive', tab: undefined })}`, count: count('inactive') },
    { key: 'companies', label: 'Companies', href: `/contacts${qs(base, { tab: 'companies', status: undefined })}` },
  ];

  return (
    <div>
      <PageHeader title={plural} subtitle={all ? 'Every business, each person tagged with their business' : ctx.current!.name}
        actions={<AddButton kind="contact" label={`Add ${label(ctx, 'contact', 'contact').toLowerCase()}`} />} />
      <form className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-3.5 size-5 text-muted" />
        <input name="q" defaultValue={q} placeholder="Search name, email or phone…" className="h-12 w-full rounded-2xl border border-border bg-surface pl-12 pr-4 text-sm placeholder:text-muted focus:border-accent focus:outline-none" />
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {b ? <input type="hidden" name="b" value={b} /> : null}
      </form>
      <Tabs tabs={tabs} active={tab === 'companies' ? 'companies' : status ?? 'all'} />
      {all ? <BusinessFilter businesses={ctx.businesses} active={b} hrefFor={(id) => `/contacts${qs(base, { b: id })}`} /> : null}
      {data.tags.length && tab === 'people' ? (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {data.tags.map((t) => (
            <a key={t.tag} href={`/contacts${qs(base, { tag: tag === t.tag ? undefined : t.tag })}`} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${tag === t.tag ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted'}`}>#{t.tag} <span className="opacity-60">{Number(t.n)}</span></a>
          ))}
        </div>
      ) : null}

      {tab === 'companies' ? (
        data.cos.length ? (
          <List>
            {data.cos.map(({ co, n }) => (
              <ListRow key={co.id} href={`/contacts?company=${co.id}`} icon={<Building2 className="size-5" />} title={co.name}
                meta={<>{all ? <BusinessBadge business={businessById(ctx, co.subAccountId)} /> : null}<span>{Number(n)} {Number(n) === 1 ? 'person' : 'people'}</span>{co.phone ? <span>{co.phone}</span> : null}</>} />
            ))}
          </List>
        ) : <EmptyState title="No companies yet" body="Companies are created automatically when you add a contact with a company name." />
      ) : people.length ? (
        <List>
          {people.map(({ c, co }) => (
            <ListRow key={c.id} href={`/contacts/${c.id}`}
              icon={<span className="text-sm font-semibold">{(c.firstName[0] ?? c.email?.[0] ?? '?').toUpperCase()}{(c.lastName[0] ?? '').toUpperCase()}</span>}
              title={<span className="flex items-center gap-2">{contactName(c)}{co ? <span className="truncate text-xs font-normal text-muted">{c.jobTitle ? `${c.jobTitle}, ` : ''}{co.name}</span> : null}</span>}
              meta={<>{all ? <BusinessBadge business={businessById(ctx, c.subAccountId)} /> : null}<StatusBadge status={c.status} />{c.phone ? <span>{c.phone}</span> : null}{c.email ? <span className="truncate">{c.email}</span> : null}</>}
              right={c.lastContactedAt ? <span className="text-xs font-normal text-muted">{relativeTime(c.lastContactedAt)}</span> : <span className="text-xs font-normal text-muted">Not contacted</span>} />
          ))}
        </List>
      ) : <EmptyState title={q ? `No one matches "${q}"` : 'No contacts yet'} body="Add someone with the + button, or they'll appear automatically from forms, messages and payments." />}
      {tab === 'people' ? <Pager path="/contacts" params={p} page={pg.page} hasNext={hasNext} shown={people.length} /> : null}
    </div>
  );
}
