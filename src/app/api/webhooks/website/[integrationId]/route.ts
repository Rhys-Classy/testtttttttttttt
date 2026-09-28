import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { isUuid, withAnonymous, withSystem } from '@/db/context';
import { safeEqual } from '@/lib/crypto';
import { getBusinessCredentials } from '@/server/services/integrations';
import { createLead } from '@/server/services/crm';
import { emit } from '@/server/services/_common';
import { notify } from '@/server/services/notifications';
import { friendlyError } from '@/server/actions/_util';

/**
 * Generic website form webhook (WordPress, Webflow, GoHighLevel, Zapier...).
 * POST JSON or form data to /api/webhooks/website/<id>?token=<secret>.
 * Recognised fields: name/first_name/last_name, email, phone, message, source; everything else is kept on the lead.
 */
export async function POST(req: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  if (!isUuid(integrationId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const subAccountId = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string | null }>(sql`select app.resolve_integration(${integrationId}::uuid) as id`)).rows[0]?.id ?? null);
  if (!subAccountId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const token = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-webhook-token') ?? '';
  const ct = req.headers.get('content-type') ?? '';
  const body: Record<string, unknown> = ct.includes('json') ? await req.json().catch(() => ({})) : Object.fromEntries((await req.formData()).entries());
  const pick = (...keys: string[]) => { for (const k of keys) { const v = body[k] ?? body[k.toLowerCase()]; if (typeof v === 'string' && v.trim()) return v.trim(); } return undefined; };
  const scope = { subAccountId, userId: null, actor: 'system' as const };
  try {
    const result = await withSystem(subAccountId, async (tx) => {
      const creds = await getBusinessCredentials(tx, scope, ['website']);
      if (!creds || creds.integration.id !== integrationId || !safeEqual(String(creds.config.token ?? ''), token)) return null;
      const name = pick('name', 'full_name', 'fullName') ?? [pick('first_name', 'firstName'), pick('last_name', 'lastName')].filter(Boolean).join(' ');
      const extra = Object.entries(body).filter(([k]) => !['name', 'email', 'phone', 'token'].includes(k)).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
      const { lead, contact } = await createLead(tx, scope, {
        name, email: pick('email', 'Email'), phone: pick('phone', 'mobile', 'Phone'),
        source: (pick('source') ?? String(creds.config.defaultSource ?? 'website')) as never, notes: pick('message', 'comments', 'notes') ?? extra.slice(0, 2000),
      });
      await emit(tx, scope, 'form.submitted', { entityType: 'lead', entityId: lead.id, contactId: contact.id, payload: { source: 'website_webhook' } });
      await notify(tx, scope, { type: 'lead.created', severity: 'info', title: `New website enquiry: ${name || contact.email || contact.phone}`, link: `/contacts/${contact.id}` });
      return lead.id;
    });
    if (!result) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    return NextResponse.json({ ok: true, leadId: result });
  } catch (e) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 400 });
  }
}
