import { requireContext } from '@/server/context';
import { addBusinessAction } from '@/server/actions/settings';
import { MODULE_PRESETS } from '@/lib/modules/registry';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { BusinessDot } from '@/components/business-badge';
import { ActionForm } from '@/components/action-form';
import { ArchiveButton } from './archive-button';

export const metadata = { title: 'Businesses' };

export default async function BusinessesPage() {
  const ctx = await requireContext();
  return (
    <div className="space-y-5">
      <PageHeader title="Businesses" subtitle="One login, as many businesses as you run. Each one's data is walled off from the others." />
      <Card><CardHeader title={`${ctx.businesses.length} businesses`} /><CardBody className="divide-y divide-border">
        {ctx.businesses.map((b) => (
          <div key={b.id} className="flex items-center gap-3 py-3">
            <BusinessDot color={b.color} />
            <div className="min-w-0 flex-1"><p className="font-medium">{b.name}</p><p className="text-xs text-muted">{b.enabledModules.length} modules · {b.timezone} · {b.taxRegime.replace('_', ' ')}</p></div>
            {ctx.isAccountAdmin ? <ArchiveButton id={b.id} name={b.name} /> : null}
          </div>
        ))}
      </CardBody></Card>
      {ctx.isAccountAdmin ? (
        <Card><CardHeader title="Add a business" /><CardBody>
          <ActionForm action={addBusinessAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_5rem_auto] sm:items-end">
            <Field label="Business name"><Input name="name" required placeholder="New business" /></Field>
            <Field label="Starting setup"><Select name="preset" defaultValue="trades">{Object.entries(MODULE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
            <Field label="Colour"><Input type="color" name="color" defaultValue="#15803d" className="p-1" /></Field>
            <Button type="submit" variant="primary">Add</Button>
          </ActionForm>
        </CardBody></Card>
      ) : null}
    </div>
  );
}
