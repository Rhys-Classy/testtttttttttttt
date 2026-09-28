import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { messageTemplates, subAccounts, type Terminology } from '@/db/schema';
import { MODULE_PRESETS, type ModuleKey } from '@/lib/modules/registry';
import { ValidationError, cleanStr, type Scope } from './_common';
import { DEFAULT_STAGES, createPipeline, defineCustomField } from './crm';

export type BusinessInput = {
  name: string;
  shortName?: string | null;
  color?: string;
  preset?: keyof typeof MODULE_PRESETS;
  modules?: ModuleKey[];
  timezone?: string;
  terminology?: Terminology;
  abn?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'business';
}

const PALETTE = ['#0f766e', '#be185d', '#7c3aed', '#0369a1', '#b45309', '#15803d', '#c2410c', '#4338ca'];

/** Insert the business row. Only master-account owners/admins pass the RLS insert policy. */
export async function createBusiness(tx: Tx, accountId: string, input: BusinessInput) {
  const name = cleanStr(input.name);
  if (!name) throw new ValidationError('Business name is required.');
  const existing = await tx.select({ slug: subAccounts.slug, sortOrder: subAccounts.sortOrder }).from(subAccounts).where(eq(subAccounts.accountId, accountId));
  let slug = slugify(name);
  for (let i = 2; existing.some((e) => e.slug === slug); i++) slug = `${slugify(name)}-${i}`;
  const modules = input.modules ?? MODULE_PRESETS[input.preset ?? 'everything']?.modules ?? MODULE_PRESETS.everything.modules;
  const [row] = await tx.insert(subAccounts).values({
    accountId,
    name,
    slug,
    shortName: cleanStr(input.shortName) ?? initials(name),
    color: input.color ?? PALETTE[existing.length % PALETTE.length],
    timezone: input.timezone ?? 'Australia/Melbourne',
    enabledModules: modules,
    terminology: input.terminology ?? {},
    tradingName: name,
    abn: cleanStr(input.abn),
    email: cleanStr(input.email),
    phone: cleanStr(input.phone),
    website: cleanStr(input.website),
    sortOrder: existing.reduce((m, e) => Math.max(m, e.sortOrder), 0) + 1,
    invoiceTerms: 'Payment due within 14 days. Thank you for your business.',
    quoteTerms: 'This quote is valid for 30 days. A deposit may be required to secure your booking.',
  }).returning();
  return row;
}

export function initials(name: string): string {
  const words = name.replace(/&/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['and', 'of', 'the', 'co'].includes(w.toLowerCase()));
  return (words.map((w) => w[0]).join('').slice(0, 3) || name.slice(0, 2)).toUpperCase();
}

/** Default pipeline, starter templates and a few custom fields, per preset. Runs inside the new business. */
export async function installBusinessDefaults(tx: Tx, scope: Scope, preset: string, customFields: { entityType: 'contact' | 'deal' | 'job'; label: string; fieldType?: 'text' | 'select' | 'date' | 'number' | 'textarea'; options?: string[] }[] = []) {
  const stages = preset === 'care'
    ? [
        { name: 'Enquiry', kind: 'open' as const, probability: 10 },
        { name: 'Intake call', kind: 'open' as const, probability: 30 },
        { name: 'Service agreement sent', kind: 'open' as const, probability: 60 },
        { name: 'Active client', kind: 'won' as const, probability: 100 },
        { name: 'Not proceeding', kind: 'lost' as const, probability: 0 },
      ]
    : DEFAULT_STAGES;
  await createPipeline(tx, scope, preset === 'care' ? 'Intake' : 'Sales', stages, true);
  for (const f of customFields) await defineCustomField(tx, scope, f);
  await tx.insert(messageTemplates).values([
    { subAccountId: scope.subAccountId, channel: 'sms', name: 'New lead — first touch', body: 'Hi {{contact.first_name|there}}, thanks for reaching out to {{business.name}}! When is a good time for a quick call?' },
    { subAccountId: scope.subAccountId, channel: 'email', name: 'Follow up', subject: 'Following up', body: 'Hi {{contact.first_name|there}},\n\nJust following up on your enquiry. Happy to answer any questions.\n\nThanks,\n{{business.name}}' },
    { subAccountId: scope.subAccountId, channel: 'sms', name: 'Appointment reminder', body: 'Hi {{contact.first_name|there}}, reminder of your appointment with {{business.name}}: {{appointment.when}}. Reply C to confirm.' },
  ]);
}

export async function listBusinesses(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  return tx.select().from(subAccounts)
    .where(opts.includeArchived ? sql`true` : isNull(subAccounts.archivedAt))
    .orderBy(asc(subAccounts.sortOrder), asc(subAccounts.name));
}

export async function updateBusinessSettings(tx: Tx, scope: Scope, patch: Partial<typeof subAccounts.$inferInsert>) {
  const allowed: (keyof typeof subAccounts.$inferInsert)[] = [
    'name', 'shortName', 'color', 'tradingName', 'legalName', 'abn', 'acn', 'address', 'phone', 'email', 'website', 'branding',
    'terminology', 'currency', 'timezone', 'taxRegime', 'taxRegistered', 'pricesIncludeTax', 'invoicePrefix', 'quotePrefix',
    'jobPrefix', 'paymentTermsDays', 'quoteValidityDays', 'invoiceTerms', 'quoteTerms', 'bankDetails', 'enabledModules',
    'nextInvoiceNumber', 'nextQuoteNumber', 'region', 'archivedAt',
  ];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof typeof subAccounts.$inferInsert)));
  const [row] = await tx.update(subAccounts).set({ ...clean, updatedAt: new Date() })
    .where(and(eq(subAccounts.id, scope.subAccountId))).returning();
  if (!row) throw new ValidationError('You do not have permission to change this business.');
  return row;
}
