import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { contacts, formSubmissions, forms } from '@/db/schema';
import { isUuid } from '@/db/context';
import { formatDateTime } from '@/lib/dates';
import { env } from '@/lib/env';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { formBuilderContext } from '@/server/queries/form-ctx';
import { deleteFormAction } from '@/server/actions/marketing';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { BusinessBadge } from '@/components/business-badge';
import { FormBuilder } from '../form-builder';

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, async (tx) => {
    const [f] = await tx.select().from(forms).where(eq(forms.id, id));
    if (!f) return null;
    const subs = await tx.select({ s: formSubmissions, c: contacts }).from(formSubmissions)
      .leftJoin(contacts, and(eq(contacts.id, formSubmissions.contactId), eq(contacts.subAccountId, formSubmissions.subAccountId)))
      .where(and(eq(formSubmissions.subAccountId, f.subAccountId), eq(formSubmissions.formId, f.id))).orderBy(desc(formSubmissions.createdAt)).limit(30);
    return { f, subs };
  });
  if (!d) notFound();
  const biz = businessById(ctx, d.f.subAccountId)!;
  const fc = await formBuilderContext(ctx, [biz.id]);
  return (
    <div className="space-y-6">
      <PageHeader title={d.f.name} subtitle={<BusinessBadge business={biz} full />} actions={<form action={deleteFormAction.bind(null, biz.id, d.f.id)}><button className="text-sm text-muted hover:text-danger">Delete</button></form>} />
      <FormBuilder appUrl={env().APP_URL} businesses={[{ id: biz.id, name: biz.name }]} pipelines={fc.pipelinesBy} customFields={fc.fieldsBy}
        initial={{ id: d.f.id, subAccountId: biz.id, name: d.f.name, fields: d.f.fields, settings: d.f.settings, status: d.f.status, publicId: d.f.publicId }} />
      <Card>
        <CardHeader title="Latest submissions" subtitle={`${d.f.submissionCount} total`} />
        <CardBody className="space-y-2">
          {d.subs.length ? d.subs.map(({ s, c }) => (
            <details key={s.id} className="rounded-xl border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer">{c ? <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">{contactName(c)}</Link> : 'Unknown'} <span className="text-xs text-muted">· {formatDateTime(s.createdAt, ctx.tz)}</span></summary>
              <dl className="mt-2 space-y-1">{d.f.fields.map((f) => <div key={f.id} className="flex gap-2"><dt className="w-40 shrink-0 text-muted">{f.label}</dt><dd>{Array.isArray(s.data[f.id]) ? (s.data[f.id] as string[]).join(', ') : String(s.data[f.id] ?? '—')}</dd></div>)}</dl>
            </details>
          )) : <p className="text-sm text-muted">No submissions yet.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
