import { requireContext } from '@/server/context';
import { saveBusinessDetailsAction } from '@/server/actions/settings';
import { listTaxRegimes } from '@/lib/tax';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/action-form';
import { PickBusiness } from '@/components/pick-business';

export const metadata = { title: 'Business details' };

const TIMEZONES = ['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'Pacific/Auckland'];

export default async function BusinessSettingsPage() {
  const ctx = await requireContext();
  if (!ctx.current) return <PickBusiness ctx={ctx} what="Business details" />;
  const b = ctx.current;
  const a = b.address ?? {};
  return (
    <div>
      <PageHeader title="Business details" subtitle={b.name} />
      <ActionForm action={saveBusinessDetailsAction} className="space-y-5">
        <input type="hidden" name="subAccountId" value={b.id} />
        <Card><CardHeader title="Identity" /><CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Business name"><Input name="name" defaultValue={b.name} required /></Field>
          <div className="grid grid-cols-[1fr_5rem] gap-2"><Field label="Short name" hint="Shown on badges"><Input name="shortName" defaultValue={b.shortName ?? ''} maxLength={6} /></Field><Field label="Colour"><Input type="color" name="color" defaultValue={b.color} className="p-1" /></Field></div>
          <Field label="Trading name"><Input name="tradingName" defaultValue={b.tradingName ?? ''} /></Field>
          <Field label="Legal entity name"><Input name="legalName" defaultValue={b.legalName ?? ''} /></Field>
          <Field label="ABN"><Input name="abn" defaultValue={b.abn ?? ''} inputMode="numeric" placeholder="51 824 753 556" /></Field>
          <Field label="ACN (if a company)"><Input name="acn" defaultValue={b.acn ?? ''} inputMode="numeric" /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={b.phone ?? ''} /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={b.email ?? ''} /></Field>
          <Field label="Website" className="sm:col-span-2"><Input name="website" defaultValue={b.website ?? ''} /></Field>
          <Field label="Street" className="sm:col-span-2"><Input name="line1" defaultValue={a.line1 ?? ''} /></Field>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2"><Field label="Suburb"><Input name="suburb" defaultValue={a.suburb ?? ''} /></Field><Field label="State"><Input name="state" defaultValue={a.state ?? 'VIC'} /></Field><Field label="Postcode"><Input name="postcode" defaultValue={a.postcode ?? ''} /></Field></div>
        </CardBody></Card>

        <Card><CardHeader title="Tax & money" /><CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tax"><Select name="taxRegime" defaultValue={b.taxRegime}>{listTaxRegimes().map((r) => <option key={r.id} value={r.id}>{r.id === 'AU_GST' ? 'Australia — GST 10%' : r.id === 'NZ_GST' ? 'New Zealand — GST 15%' : 'No tax'}</option>)}</Select></Field>
          <Field label="Currency"><Select name="currency" defaultValue={b.currency}><option>AUD</option><option>NZD</option><option>USD</option></Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxRegistered" defaultChecked={b.taxRegistered} />Registered for GST (issue Tax Invoices)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pricesIncludeTax" defaultChecked={b.pricesIncludeTax} />Prices include GST by default</label>
          <Field label="Timezone"><Select name="timezone" defaultValue={b.timezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Payment terms (days)"><Input name="paymentTermsDays" type="number" min={0} defaultValue={b.paymentTermsDays} /></Field>
          <Field label="Bank details (shown on invoices)" className="sm:col-span-2"><Textarea name="bankDetails" rows={3} defaultValue={b.bankDetails ?? ''} placeholder={'Account name\nBSB 000-000\nAccount 12345678'} /></Field>
        </CardBody></Card>

        <Card><CardHeader title="Quotes & invoices" /><CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Invoice prefix"><Input name="invoicePrefix" defaultValue={b.invoicePrefix} /></Field>
          <Field label="Quote prefix"><Input name="quotePrefix" defaultValue={b.quotePrefix} /></Field>
          <Field label="Job prefix"><Input name="jobPrefix" defaultValue={b.jobPrefix} /></Field>
          <Field label="Quotes valid for (days)"><Input name="quoteValidityDays" type="number" min={1} defaultValue={b.quoteValidityDays} /></Field>
          <Field label="Logo URL"><Input name="logoUrl" defaultValue={b.branding?.logoUrl ?? ''} placeholder="https://" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Invoice colour"><Input type="color" name="invoiceAccent" defaultValue={b.branding?.invoiceAccent ?? b.color} className="p-1" /></Field><Field label="Quote colour"><Input type="color" name="quoteAccent" defaultValue={b.branding?.quoteAccent ?? b.color} className="p-1" /></Field></div>
          <Field label="Default invoice terms" className="sm:col-span-3"><Textarea name="invoiceTerms" rows={2} defaultValue={b.invoiceTerms ?? ''} /></Field>
          <Field label="Default quote terms" className="sm:col-span-3"><Textarea name="quoteTerms" rows={2} defaultValue={b.quoteTerms ?? ''} /></Field>
        </CardBody></Card>

        <Card><CardHeader title="Words this business uses" subtitle="e.g. a support provider calls contacts “Clients”" /><CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Contact"><Input name="termContact" defaultValue={b.terminology?.contact ?? ''} placeholder="Contact" /></Field>
          <Field label="Contacts"><Input name="termContacts" defaultValue={b.terminology?.contacts ?? ''} placeholder="Contacts" /></Field>
          <Field label="Job"><Input name="termJob" defaultValue={b.terminology?.job ?? ''} placeholder="Job" /></Field>
          <Field label="Jobs"><Input name="termJobs" defaultValue={b.terminology?.jobs ?? ''} placeholder="Jobs" /></Field>
        </CardBody></Card>
        <div className="sticky bottom-20 flex justify-end md:bottom-4"><Button type="submit" variant="primary" size="lg">Save business settings</Button></div>
      </ActionForm>
    </div>
  );
}
