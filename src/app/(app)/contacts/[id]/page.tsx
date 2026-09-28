import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { CalendarDays, FileText, Mail, MessageSquare, Phone, Receipt } from 'lucide-react';
import {
  activities, appointments, companies, contacts, customFieldDefinitions, deals, documents, invoices, leads, pipelineStages, quotes, tasks,
} from '@/db/schema';
import { isUuid } from '@/db/context';
import { formatDate, formatDateTime, relativeTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { TaskRow } from '@/components/dashboard/task-row';
import { ContactForm, NoteBox, TagEditor } from './client-bits';
import { ContactQuickButtons } from './quick-buttons';
import { DocumentUpload } from '@/components/document-upload';

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const tz = ctx.tz;
  const data = await readScope(ctx, async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, id));
    if (!c) return null;
    const t = (col: { subAccountId: unknown }) => eq(col.subAccountId as never, c.subAccountId);
    const [co] = c.companyId ? await tx.select().from(companies).where(and(t(companies), eq(companies.id, c.companyId))) : [];
    return {
      c, co,
      colleagues: c.companyId ? await tx.select().from(contacts).where(and(t(contacts), eq(contacts.companyId, c.companyId), ne(contacts.id, c.id))).limit(10) : [],
      defs: await tx.select().from(customFieldDefinitions).where(and(t(customFieldDefinitions), eq(customFieldDefinitions.entityType, 'contact'))).orderBy(asc(customFieldDefinitions.sortOrder)),
      timeline: await tx.select().from(activities).where(and(t(activities), eq(activities.contactId, c.id))).orderBy(desc(activities.createdAt)).limit(60),
      deals: await tx.select({ d: deals, s: pipelineStages }).from(deals).leftJoin(pipelineStages, and(eq(pipelineStages.id, deals.stageId), eq(pipelineStages.subAccountId, deals.subAccountId))).where(and(t(deals), eq(deals.contactId, c.id))).orderBy(desc(deals.updatedAt)),
      quotes: await tx.select().from(quotes).where(and(t(quotes), eq(quotes.contactId, c.id))).orderBy(desc(quotes.createdAt)).limit(10),
      invoices: await tx.select().from(invoices).where(and(t(invoices), eq(invoices.contactId, c.id))).orderBy(desc(invoices.createdAt)).limit(10),
      tasks: await tx.select().from(tasks).where(and(t(tasks), eq(tasks.contactId, c.id), inArray(tasks.status, ['todo', 'in_progress', 'snoozed']))).orderBy(asc(tasks.dueAt)),
      appts: await tx.select().from(appointments).where(and(t(appointments), eq(appointments.contactId, c.id), gte(appointments.startsAt, new Date(Date.now() - 86_400_000)), ne(appointments.status, 'cancelled'))).orderBy(asc(appointments.startsAt)),
      docs: await tx.select().from(documents).where(and(t(documents), eq(documents.contactId, c.id))).orderBy(desc(documents.createdAt)),
      leads: await tx.select().from(leads).where(and(t(leads), eq(leads.contactId, c.id))).orderBy(desc(leads.createdAt)),
    };
  });
  if (!data) notFound();
  const { c } = data;
  const biz = businessById(ctx, c.subAccountId);
  const owed = data.invoices.filter((i) => ['sent', 'viewed', 'partially_paid', 'overdue'].includes(i.status)).reduce((s, i) => s + i.totalCents - i.amountPaidCents, 0);
  const paid = data.invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalCents, 0);
  const openLead = data.leads.find((l) => ['new', 'contacted', 'qualified'].includes(l.status));

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white" style={{ backgroundColor: biz?.color }}>
            {(c.firstName[0] ?? '?').toUpperCase()}{(c.lastName[0] ?? '').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{contactName(c)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <BusinessBadge business={biz} full />
              <StatusBadge status={c.status} />
              {openLead ? <span className="text-xs">Lead · {openLead.source} · {openLead.status}</span> : null}
              {data.co ? <span>{c.jobTitle ? `${c.jobTitle} at ` : ''}{data.co.name}</span> : null}
              <span>Last contact: {c.lastContactedAt ? relativeTime(c.lastContactedAt) : 'never'}</span>
            </div>
            <div className="mt-3"><TagEditor subAccountId={c.subAccountId} contactId={c.id} tags={c.tags} /></div>
          </div>
          <div className="flex gap-6 text-right">
            <div><p className="text-xs text-muted">Owes</p><p className={`text-lg font-semibold tabular-nums ${owed ? 'text-danger' : ''}`}>{formatMoney(owed)}</p></div>
            <div><p className="text-xs text-muted">Lifetime</p><p className="text-lg font-semibold tabular-nums">{formatMoney(paid)}</p></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {c.phone ? <a href={`tel:${c.phone}`} className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg"><Phone className="size-4" />Call</a> : null}
          {c.phone ? <Link href={`/inbox?contact=${c.id}&channel=sms`} className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium"><MessageSquare className="size-4" />SMS</Link> : null}
          {c.email ? <Link href={`/inbox?contact=${c.id}&channel=email`} className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium"><Mail className="size-4" />Email</Link> : null}
          <ContactQuickButtons contact={{ id: c.id, label: contactName(c), subAccountId: c.subAccountId }} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {data.tasks.length || data.appts.length ? (
            <Card>
              <CardHeader title="Next up" />
              <CardBody>
                {data.appts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                    <CalendarDays className="size-5 text-accent" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.title}</p><p className="text-xs text-muted">{formatDateTime(a.startsAt, tz)}{a.location ? ` · ${a.location}` : ''}</p></div>
                  </div>
                ))}
                <div className="-mx-2">
                  {data.tasks.map((t) => <TaskRow key={t.id} task={{ id: t.id, subAccountId: t.subAccountId, title: t.title, done: false, priority: t.priority, dueLabel: t.dueAt ? formatDate(t.dueAt, tz, { weekday: 'short', day: 'numeric', month: 'short' }) : null, overdue: !!t.dueAt && t.dueAt < new Date() }} />)}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <NoteBox subAccountId={c.subAccountId} contactId={c.id} />

          <Card>
            <CardHeader title="Timeline" subtitle="Everything that happened with this person" />
            <CardBody>
              {data.timeline.length ? (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {data.timeline.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
                      <p className="text-sm">{a.summary}</p>
                      <p className="text-xs text-muted">{formatDateTime(a.createdAt, tz)} · {a.type.replace(/_/g, ' ')}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted">Nothing yet.</p>}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <ContactForm subAccountId={c.subAccountId} companyName={data.co?.name ?? null} defs={data.defs.map((d) => ({ key: d.key, label: d.label, fieldType: d.fieldType, options: d.options }))}
                contact={{ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, website: c.website, jobTitle: c.jobTitle, status: c.status, source: c.source, address: c.address as Record<string, string | undefined>, customFields: c.customFields }} />
            </CardBody>
          </Card>

          {data.colleagues.length ? (
            <Card>
              <CardHeader title={`Also at ${data.co?.name}`} />
              <CardBody className="space-y-1">
                {data.colleagues.map((p) => <Link key={p.id} href={`/contacts/${p.id}`} className="flex justify-between py-1 text-sm"><span className="font-medium">{contactName(p)}</span><span className="text-muted">{p.jobTitle}</span></Link>)}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Money" />
            <CardBody className="space-y-1">
              {[...data.quotes.map((q) => ({ id: q.id, href: `/quotes/${q.id}`, icon: FileText, label: `${q.number}${q.title ? ` · ${q.title}` : ''}`, status: q.status, amount: q.totalCents, at: q.createdAt })),
                ...data.invoices.map((i) => ({ id: i.id, href: `/invoices/${i.id}`, icon: Receipt, label: `${i.number}${i.title ? ` · ${i.title}` : ''}`, status: i.status, amount: i.totalCents, at: i.createdAt }))]
                .sort((a, b) => b.at.getTime() - a.at.getTime())
                .map((r) => (
                  <Link key={r.id} href={r.href} className="flex items-center gap-2 rounded-lg py-1.5 text-sm hover:bg-surface-2">
                    <r.icon className="size-4 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <StatusBadge status={r.status} />
                    <span className="tabular-nums">{formatMoney(r.amount)}</span>
                  </Link>
                ))}
              {!data.quotes.length && !data.invoices.length ? <p className="text-sm text-muted">No quotes or invoices yet.</p> : null}
            </CardBody>
          </Card>

          {data.deals.length ? (
            <Card>
              <CardHeader title="Deals" />
              <CardBody className="space-y-1">
                {data.deals.map(({ d, s }) => (
                  <Link key={d.id} href={`/pipeline?deal=${d.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate">{d.title}</span>
                    <span className="shrink-0 text-muted">{s?.name} · {formatMoney(d.valueCents)}</span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Documents & photos" />
            <CardBody>
              <DocumentUpload subAccountId={c.subAccountId} entityType="contact" entityId={c.id} contactId={c.id} />
              <ul className="mt-3 space-y-1">
                {data.docs.map((d) => <li key={d.id}><a href={`/api/documents/${d.id}`} className="block truncate text-sm text-accent hover:underline">{d.filename}</a></li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
