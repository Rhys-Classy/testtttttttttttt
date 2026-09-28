import Link from 'next/link';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { ArrowLeft, Mail, MessageSquare, Phone } from 'lucide-react';
import { contacts, conversations, messages, messageTemplates } from '@/db/schema';
import { isUuid } from '@/db/context';
import { pgArray } from '@/db/sql';
import { formatDateTime, relativeTime } from '@/lib/dates';
import { can, businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { qs, sp1, type SP } from '@/server/page-helpers';
import { Tabs } from '@/components/ui/list';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { StatusBadge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { Composer, ThreadActions } from './thread-client';
import { ComposeToClient } from './compose-to';

import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Inbox' };

const CHANNEL_ICON = { sms: MessageSquare, email: Mail, call: Phone, chat: MessageSquare, facebook: MessageSquare, instagram: MessageSquare } as const;

export default async function InboxPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  if (!can(ctx, 'inbox.view')) return <NoAccess what="the inbox" />;
  const p = await searchParams;
  const filter = sp1(p.filter) ?? 'open';
  const b = sp1(p.b);
  const selected = isUuid(sp1(p.c)) ? sp1(p.c)! : null;
  const composeContact = isUuid(sp1(p.contact)) ? sp1(p.contact)! : null;
  const ids = b && ctx.scopeIds.includes(b) ? [b] : ctx.scopeIds;
  const tz = ctx.tz;

  const data = await readScope(ctx, async (tx) => {
    const base = [sql`${conversations.subAccountId} = any(${pgArray(ids)})`];
    if (filter === 'open') base.push(eq(conversations.status, 'open'));
    if (filter === 'mine') base.push(and(eq(conversations.status, 'open'), eq(conversations.assignedUserId, ctx.user.id))!);
    if (filter === 'unassigned') base.push(and(eq(conversations.status, 'open'), isNull(conversations.assignedUserId))!);
    if (filter === 'snoozed') base.push(eq(conversations.status, 'snoozed'));
    if (filter === 'closed') base.push(eq(conversations.status, 'closed'));
    const list = await tx.select({ v: conversations, c: contacts }).from(conversations)
      .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.subAccountId, conversations.subAccountId)))
      .where(and(...base)).orderBy(desc(conversations.unread), desc(conversations.lastMessageAt)).limit(100);
    let thread = null;
    if (selected) {
      const [row] = await tx.select({ v: conversations, c: contacts }).from(conversations)
        .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.subAccountId, conversations.subAccountId)))
        .where(eq(conversations.id, selected));
      if (row) {
        if (row.v.unread) await tx.update(conversations).set({ unread: false }).where(and(eq(conversations.subAccountId, row.v.subAccountId), eq(conversations.id, row.v.id)));
        thread = { ...row, msgs: await tx.select().from(messages).where(and(eq(messages.subAccountId, row.v.subAccountId), eq(messages.conversationId, row.v.id))).orderBy(asc(messages.createdAt)).limit(300) };
      }
    }
    const compose = composeContact && !thread ? (await tx.select().from(contacts).where(eq(contacts.id, composeContact)))[0] ?? null : null;
    const bizForTemplates = thread?.v.subAccountId ?? compose?.subAccountId;
    const templates = bizForTemplates ? await tx.select().from(messageTemplates).where(and(eq(messageTemplates.subAccountId, bizForTemplates), eq(messageTemplates.isSignature, false))) : [];
    const counts = await tx.select({ s: conversations.status, n: sql<number>`count(*)`, u: sql<number>`count(*) filter (where ${conversations.unread})` }).from(conversations).where(sql`${conversations.subAccountId} = any(${pgArray(ids)})`).groupBy(conversations.status);
    return { list, thread, compose, templates, counts };
  });
  const n = (s: string) => Number(data.counts.find((c) => c.s === s)?.n ?? 0);
  const base = { filter: filter === 'open' ? undefined : filter, b };
  const all = !ctx.current;
  const showThread = !!(data.thread || data.compose);
  const t = data.thread;
  const person = t?.c ?? data.compose;
  const threadBiz = businessById(ctx, t?.v.subAccountId ?? data.compose?.subAccountId);
  const channel = ((sp1(p.channel) as 'email' | 'sms') ?? (t?.v.channel === 'email' ? 'email' : person?.phone ? 'sms' : 'email'));

  return (
    <div className="-mx-4 -mt-5 md:mx-0 md:mt-0">
      <div className="grid grid-cols-1 h-[calc(100dvh-4rem-4rem)] overflow-hidden border-border bg-surface md:h-[calc(100dvh-7rem)] md:grid-cols-[22rem_1fr] md:rounded-2xl md:border">
        <aside className={cn('flex min-h-0 flex-col border-r border-border', showThread && 'hidden md:flex')}>
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between"><h1 className="text-lg font-semibold">Inbox</h1><Link href="/inbox?compose=1" className="text-sm font-medium text-accent">New</Link></div>
            <Tabs active={filter} tabs={[
              { key: 'open', label: 'Open', href: `/inbox${qs(base, { filter: undefined })}`, count: n('open') },
              { key: 'mine', label: 'Mine', href: `/inbox${qs(base, { filter: 'mine' })}` },
              { key: 'snoozed', label: 'Snoozed', href: `/inbox${qs(base, { filter: 'snoozed' })}`, count: n('snoozed') },
              { key: 'closed', label: 'Closed', href: `/inbox${qs(base, { filter: 'closed' })}` },
            ]} />
            {all ? <BusinessFilter businesses={ctx.businesses} active={b} hrefFor={(id) => `/inbox${qs(base, { b: id })}`} /> : null}
            {sp1(p.compose) ? <div className="mt-2"><p className="mb-1 text-xs text-muted">Message someone:</p><ComposeTo /></div> : null}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {data.list.map(({ v, c }) => {
              const I = CHANNEL_ICON[v.channel] ?? MessageSquare;
              return (
                <li key={v.id}>
                  <Link href={`/inbox${qs(base, { c: v.id })}`} className={cn('flex gap-3 border-b border-border px-3 py-3 hover:bg-surface-2', v.id === selected && 'bg-accent-soft')}>
                    <I className={cn('mt-0.5 size-4 shrink-0', v.unread ? 'text-accent' : 'text-muted')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn('truncate text-sm', v.unread ? 'font-semibold' : 'font-medium')}>{c ? contactName(c) : 'Unknown'}</p>
                        <span className="shrink-0 text-xs text-muted">{v.lastMessageAt ? relativeTime(v.lastMessageAt) : ''}</span>
                      </div>
                      <p className={cn('truncate text-xs', v.unread ? 'text-text' : 'text-muted')}>{v.lastDirection === 'outbound' ? 'You: ' : ''}{v.lastMessagePreview}</p>
                      {all ? <div className="mt-1"><BusinessBadge business={businessById(ctx, v.subAccountId)} /></div> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
            {!data.list.length ? <EmptyState title="Inbox zero" body="Emails, SMS and messages from customers land here." /> : null}
          </ul>
        </aside>

        <section className={cn('flex min-h-0 flex-col', !showThread && 'hidden md:flex')}>
          {person && threadBiz ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                <Link href={`/inbox${qs(base, {})}`} className="flex size-9 items-center justify-center rounded-lg text-muted md:hidden" aria-label="Back"><ArrowLeft className="size-5" /></Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/contacts/${person.id}`} className="font-semibold hover:underline">{contactName(person)}</Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><BusinessBadge business={threadBiz} />{person.phone ? <a href={`tel:${person.phone}`} className="text-accent">{person.phone}</a> : null}{person.email ? <span>{person.email}</span> : null}{person.smsOptOut ? <span className="text-danger">SMS opted out</span> : null}</div>
                </div>
                {t ? <ThreadActions subAccountId={t.v.subAccountId} id={t.v.id} contactId={t.v.contactId} status={t.v.status} assignedToMe={t.v.assignedUserId === ctx.user.id} /> : null}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-bg p-4">
                {t?.msgs.map((m) => (
                  <div key={m.id} className={cn('max-w-[85%]', m.direction === 'outbound' ? 'ml-auto' : '')}>
                    <div className={cn('rounded-2xl px-4 py-2.5 text-sm', m.isInternalNote ? 'border border-warn/30 bg-warn-soft' : m.channel === 'call' ? 'border border-border bg-surface' : m.direction === 'outbound' ? 'bg-accent text-accent-fg' : 'bg-surface')}>
                      {m.subject && m.channel === 'email' ? <p className="mb-1 font-semibold">{m.subject}</p> : null}
                      {m.channel === 'call' ? <p className="mb-1 text-xs font-medium">📞 Call{m.durationSeconds ? ` · ${Math.round(m.durationSeconds / 60)} min` : ''}</p> : null}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <p className={cn('mt-1 flex gap-2 text-[11px] text-muted', m.direction === 'outbound' && 'justify-end')}>
                      <span>{m.isInternalNote ? 'Internal note · ' : ''}{m.channel.toUpperCase()} · {formatDateTime(m.sentAt ?? m.scheduledAt ?? m.createdAt, tz)}</span>
                      {m.direction === 'outbound' && !m.isInternalNote && m.channel !== 'call' ? <StatusBadge status={m.status} /> : null}
                      {m.error ? <span className="text-danger">{m.error}</span> : null}
                    </p>
                  </div>
                ))}
                {!t ? <p className="py-10 text-center text-sm text-muted">New conversation with {contactName(person)}.</p> : null}
              </div>
              <Composer subAccountId={threadBiz.id} contactId={person.id} conversationId={t?.v.id} channel={channel} canEmail={!!person.email} canSms={!!person.phone} templates={data.templates} firstName={person.firstName} businessName={threadBiz.tradingName ?? threadBiz.name} />
            </>
          ) : <div className="flex flex-1 items-center justify-center"><EmptyState title="Pick a conversation" body="Or start one from a contact." /></div>}
        </section>
      </div>
    </div>
  );
}

function ComposeTo() {
  return <ComposeToClient />;
}
