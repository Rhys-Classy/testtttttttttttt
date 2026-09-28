import { asc, eq } from 'drizzle-orm';
import { customFieldDefinitions } from '@/db/schema';
import { readScope, requireContext } from '@/server/context';
import { defineFieldAction } from '@/server/actions/crm';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/action-form';
import { PickBusiness } from '@/components/pick-business';

export const metadata = { title: 'Custom fields' };

export default async function FieldsPage() {
  const ctx = await requireContext();
  if (!ctx.current) return <PickBusiness ctx={ctx} what="Custom fields" />;
  const defs = await readScope(ctx, (tx) => tx.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.subAccountId, ctx.current!.id)).orderBy(asc(customFieldDefinitions.entityType), asc(customFieldDefinitions.sortOrder)));
  const groups = ['contact', 'deal', 'job', 'company', 'lead'] as const;
  return (
    <div className="space-y-5">
      <PageHeader title="Custom fields" subtitle={`Fields only ${ctx.current.name} needs. Add as many as you like — no developer needed.`} />
      <Card><CardHeader title="Add a field" /><CardBody>
        <ActionForm action={defineFieldAction} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem_1fr_auto] sm:items-end">
          <input type="hidden" name="subAccountId" value={ctx.current.id} />
          <Field label="Label"><Input name="label" required placeholder="Door profile" /></Field>
          <Field label="On"><Select name="entityType" defaultValue="contact">{groups.map((g) => <option key={g} value={g}>{g}</option>)}</Select></Field>
          <Field label="Type"><Select name="fieldType" defaultValue="text">{['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url', 'email', 'phone'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Options (for select)"><Input name="options" placeholder="Shaker, Flat, V-groove" /></Field>
          <Button type="submit" variant="primary">Add</Button>
        </ActionForm>
      </CardBody></Card>
      {groups.map((g) => {
        const list = defs.filter((d) => d.entityType === g);
        if (!list.length) return null;
        return (
          <Card key={g}><CardHeader title={`${g[0].toUpperCase()}${g.slice(1)} fields`} /><CardBody className="divide-y divide-border">
            {list.map((d) => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="font-medium">{d.label}</span><span className="text-muted">{d.fieldType}{d.options.length ? ` · ${d.options.join(', ')}` : ''} · <code>{d.key}</code></span></div>)}
          </CardBody></Card>
        );
      })}
    </div>
  );
}
