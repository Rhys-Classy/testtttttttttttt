import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import type { Address } from '@/db/schema/_shared';
import { leads, webhookEvents } from '@/db/schema';
import { safeEqual } from '@/lib/crypto';
import { parseMoney } from '@/lib/money';
import { Scope, ValidationError } from './_common';
import { contactName, createDeal, createLead, type LeadInput } from './crm';
import { getBusinessCredentials } from './integrations';
import { notify } from './notifications';

/**
 * Google Ads lead form webhook (Google Ads → lead form asset → Lead delivery → Webhook).
 * Google POSTs one JSON body per lead with the key we gave it in `google_key`.
 * Spec: https://developers.google.com/google-ads/webhook/docs/implementation
 */
export type GoogleLeadPayload = {
  lead_id?: string;
  google_key?: string;
  is_test?: boolean;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  form_id?: number | string;
  gcl_id?: string;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
};

type Parsed = Pick<LeadInput, 'name' | 'firstName' | 'lastName' | 'email' | 'phone' | 'companyName' | 'jobTitle'> & { address: Address; answers: string[] };

/** Google's standard column ids; anything else is a custom question kept in the lead notes. */
export function parseGoogleLead(body: GoogleLeadPayload): Parsed {
  const out: Parsed = { address: {}, answers: [] };
  for (const col of body.user_column_data ?? []) {
    const v = String(col.string_value ?? '').trim();
    if (!v) continue;
    switch (col.column_id) {
      case 'FULL_NAME': out.name = v; break;
      case 'FIRST_NAME': out.firstName = v; break;
      case 'LAST_NAME': out.lastName = v; break;
      case 'EMAIL': case 'WORK_EMAIL': out.email ??= v; break;
      case 'PHONE_NUMBER': case 'WORK_PHONE': out.phone ??= v; break;
      case 'COMPANY_NAME': out.companyName = v; break;
      case 'JOB_TITLE': out.jobTitle = v; break;
      case 'STREET_ADDRESS': out.address.line1 = v; break;
      case 'CITY': out.address.suburb = v; break;
      case 'REGION': out.address.state = v; break;
      case 'POSTAL_CODE': out.address.postcode = v; break;
      case 'COUNTRY': out.address.country = v; break;
      default: out.answers.push(`${col.column_name || col.column_id || 'Answer'}: ${v}`);
    }
  }
  return out;
}

const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));

/**
 * One Google Ads lead → contact (matched or created) + lead + deal in the first pipeline stage.
 * Test submissions ("Send test data" in Google Ads) only confirm the connection; they create nothing.
 * Duplicate deliveries of the same lead_id are ignored.
 */
export async function handleGoogleAdsLead(tx: Tx, scope: Scope, integrationId: string, body: GoogleLeadPayload) {
  const creds = await getBusinessCredentials(tx, scope, ['google_ads_leads']);
  const key = String(creds?.config.key ?? '');
  if (!creds || creds.integration.id !== integrationId || !key || !safeEqual(key, String(body.google_key ?? ''))) return { status: 'unauthorised' as const };

  if (body.is_test) {
    await notify(tx, scope, { type: 'integration', severity: 'info', title: 'Google Ads connected: test lead received', body: 'Real leads from this form will now land in your pipeline.', link: '/leads' });
    return { status: 'test' as const };
  }
  const leadId = str(body.lead_id);
  if (!leadId) throw new ValidationError('The Google Ads lead has no lead_id.');

  const { google_key: _omit, ...stored } = body;
  const inserted = await tx.insert(webhookEvents).values({
    subAccountId: scope.subAccountId, integrationId, provider: 'google_ads', providerEventId: leadId, type: 'lead', payload: stored as Record<string, unknown>,
  }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!inserted.length) return { status: 'duplicate' as const };

  const p = parseGoogleLead(body);
  if (!p.name && !p.firstName && !p.lastName && !p.email && !p.phone) throw new ValidationError('The Google Ads lead has no name, email or phone.');
  const valueCents = parseMoney(creds.config.dealValue) ?? 0;
  const ids = [str(body.campaign_id) && `Campaign ${body.campaign_id}`, str(body.adgroup_id) && `Ad group ${body.adgroup_id}`, str(body.form_id) && `Form ${body.form_id}`].filter(Boolean).join(' · ');
  const { lead, contact } = await createLead(tx, scope, {
    name: p.name, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, companyName: p.companyName, jobTitle: p.jobTitle,
    address: Object.keys(p.address).length ? p.address : undefined,
    source: 'google', title: 'Google Ads enquiry', valueCents,
    notes: ['Google Ads lead form', ...p.answers, ids].filter(Boolean).join('\n').slice(0, 2000),
  });
  const deal = await createDeal(tx, scope, { title: `${contactName(contact)} — Google Ads`, contactId: contact.id, valueCents, source: 'google' });
  // Keep the Google ids on the lead so won deals can be reported back to Google Ads later (gclid = offline conversion).
  await tx.update(leads).set({
    dealId: deal.id,
    customFields: { google_lead_id: leadId, google_campaign_id: str(body.campaign_id), google_form_id: str(body.form_id), gclid: str(body.gcl_id) },
  }).where(and(eq(leads.subAccountId, scope.subAccountId), eq(leads.id, lead.id)));
  await notify(tx, scope, { type: 'lead.created', severity: 'info', title: `New Google Ads lead: ${contactName(contact)}`, link: `/contacts/${contact.id}` });
  await tx.update(webhookEvents).set({ processedAt: new Date() }).where(and(eq(webhookEvents.subAccountId, scope.subAccountId), eq(webhookEvents.id, inserted[0].id)));
  return { status: 'created' as const, leadId: lead.id, contactId: contact.id, dealId: deal.id };
}
