import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { MapPin, Phone } from 'lucide-react';
import { activities, appointments, contacts, documents, invoices, jobs, quotes, tasks } from '@/db/schema';
import { isUuid } from '@/db/context';
import { formatDateTime, toDateKey, formatTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { TaskRow } from '@/components/dashboard/task-row';
import { DocumentUpload } from '@/components/document-upload';
import { JobNotes, JobSchedule, JobStatusStepper } from './job-controls';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const tz = ctx.tz;
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, async (tx) => {
    const [j] = await tx.select().from(jobs).where(eq(jobs.id, id));
    if (!j) return null;
    const t = <T extends { subAccountId: unknown }>(col: T) => eq(col.subAccountId as never, j.subAccountId);
    return {
      j,
      c: j.contactId ? (await tx.select().from(contacts).where(and(t(contacts), eq(contacts.id, j.contactId))))[0] : null,
      q: j.quoteId ? (await tx.select().from(quotes).where(and(t(quotes), eq(quotes.id, j.quoteId))))[0] : null,
      invs: await tx.select().from(invoices).where(and(t(invoices), eq(invoices.jobId, j.id))).orderBy(asc(invoices.createdAt)),
      tasks: await tx.select().from(tasks).where(and(t(tasks), eq(tasks.jobId, j.id), inArray(tasks.status, ['todo', 'in_progress', 'snoozed']))),
      visits: await tx.select().from(appointments).where(and(t(appointments), eq(appointments.jobId, j.id))).orderBy(asc(appointments.startsAt)),
      docs: await tx.select().from(documents).where(and(t(documents), eq(documents.entityType, 'job'), eq(documents.entityId, j.id))).orderBy(desc(documents.createdAt)),
      log: await tx.select().from(activities).where(and(t(activities), eq(activities.entityId, j.id))).orderBy(desc(activities.createdAt)).limit(20),
    };
  });
  if (!d) notFound();
  const { j, c } = d;
  const invoiced = d.invs.reduce((s, i) => s + i.totalCents, 0);
  const paid = d.invs.reduce((s, i) => s + i.amountPaidCents, 0);
  const addr = [j.address?.line1, j.address?.suburb, j.address?.state].filter(Boolean).join(', ') || [c?.address?.line1, c?.address?.suburb].filter(Boolean).join(', ');
  const photos = d.docs.filter((x) => x.kind === 'photo');
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted"><Link href="/jobs" className="hover:underline">Jobs</Link> · {j.number}</p>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{j.title} <StatusBadge status={j.status} /></h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
          <BusinessBadge business={businessById(ctx, j.subAccountId)} full />
          {c ? <Link href={`/contacts/${c.id}`} className="hover:underline">{contactName(c)}</Link> : null}
          {c?.phone ? <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-accent"><Phone className="size-3.5" />{c.phone}</a> : null}
          {addr ? <a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent"><MapPin className="size-3.5" />{addr}</a> : null}
        </div>
      </div>
      <JobStatusStepper subAccountId={j.subAccountId} id={j.id} status={j.status} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><CardHeader title="Notes" /><CardBody><JobNotes subAccountId={j.subAccountId} id={j.id} notes={j.notes ?? ''} /></CardBody></Card>
          <Card>
            <CardHeader title="Photos & documents" subtitle="Before/after photos, plans, supplier orders" />
            <CardBody>
              <DocumentUpload subAccountId={j.subAccountId} entityType="job" entityId={j.id} contactId={j.contactId} label="Add photos or files" />
              {photos.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">{photos.map((p) => <a key={p.id} href={`/api/documents/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/documents/${p.id}`} alt={p.filename} className="aspect-square w-full rounded-xl object-cover" /></a>)}</div> : null}
              <ul className="mt-3 space-y-1">{d.docs.filter((x) => x.kind !== 'photo').map((x) => <li key={x.id}><a href={`/api/documents/${x.id}`} className="text-sm text-accent hover:underline">{x.filename}</a></li>)}</ul>
            </CardBody>
          </Card>
          {d.tasks.length ? <Card><CardHeader title="Job tasks" /><CardBody className="-mx-2">{d.tasks.map((t) => <TaskRow key={t.id} task={{ id: t.id, subAccountId: t.subAccountId, title: t.title, done: false, priority: t.priority, dueLabel: t.dueAt ? formatDateTime(t.dueAt, tz) : null }} />)}</CardBody></Card> : null}
          <Card><CardHeader title="History" /><CardBody className="space-y-2">{d.log.map((a) => <div key={a.id} className="text-sm"><p>{a.summary}</p><p className="text-xs text-muted">{formatDateTime(a.createdAt, tz)}</p></div>)}</CardBody></Card>
        </div>
        <div className="space-y-5">
          <Card><CardHeader title="Schedule" /><CardBody>
            <JobSchedule subAccountId={j.subAccountId} id={j.id} startDate={j.scheduledStart ? toDateKey(j.scheduledStart, tz) : ''} startTime={j.scheduledStart ? formatTime24(j.scheduledStart, tz) : ''} endDate={j.scheduledEnd ? toDateKey(j.scheduledEnd, tz) : ''} endTime={j.scheduledEnd ? formatTime24(j.scheduledEnd, tz) : ''} />
            {d.visits.length ? <div className="mt-3 space-y-1">{d.visits.map((v) => <p key={v.id} className="text-sm">{v.title} · <span className="text-muted">{formatDateTime(v.startsAt, tz)}</span></p>)}</div> : null}
          </CardBody></Card>
          <Card><CardHeader title="Money" /><CardBody className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Job value</span><span className="font-medium tabular-nums">{formatMoney(j.valueCents)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Invoiced</span><span className="tabular-nums">{formatMoney(invoiced)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Paid</span><span className="tabular-nums text-ok">{formatMoney(paid)}</span></div>
            {d.q ? <Link href={`/quotes/${d.q.id}`} className="block pt-2 text-accent">Quote {d.q.number} ({d.q.status})</Link> : null}
            {d.invs.map((i) => <Link key={i.id} href={`/invoices/${i.id}`} className="flex justify-between text-accent"><span>{i.number}</span><StatusBadge status={i.status} /></Link>)}
            {c ? <Link href={`/invoices/new?contact=${c.id}`} className="block pt-2 font-medium text-accent">+ Invoice this job</Link> : null}
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}

function formatTime24(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
}
void formatTime;
