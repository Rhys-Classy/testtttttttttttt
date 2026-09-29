import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { isUuid, withAnonymous, withSystem } from '@/db/context';
import { handleGoogleAdsLead, type GoogleLeadPayload } from '@/server/services/google-ads';
import { ValidationError } from '@/server/services/_common';
import { friendlyError } from '@/server/actions/_util';
import { rateLimited } from '@/lib/rate-limit';

/**
 * Google Ads lead form webhook. In Google Ads: lead form asset → Lead delivery → Webhook integration,
 * paste /api/webhooks/google-ads/<id> and the key shown in Settings → Integrations.
 * Google retries anything that isn't a 200, so failures roll back and return an error.
 */
export async function POST(req: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  if (!isUuid(integrationId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const subAccountId = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string | null }>(sql`select app.resolve_integration(${integrationId}::uuid) as id`)).rows[0]?.id ?? null);
  if (!subAccountId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rateLimited(`webhook|${integrationId}|${req.headers.get('x-forwarded-for') ?? ''}`, 60, 60_000)) return NextResponse.json({ error: 'Slow down' }, { status: 429 });
  const body = await req.json().catch(() => null) as GoogleLeadPayload | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  try {
    const result = await withSystem(subAccountId, (tx) => handleGoogleAdsLead(tx, { subAccountId, userId: null, actor: 'system' }, integrationId, body));
    if (result.status === 'unauthorised') return NextResponse.json({ error: 'Invalid key' }, { status: 401 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (e) {
    // Bad data won't improve on retry (400); anything else is ours, so let Google retry (500).
    return NextResponse.json({ error: friendlyError(e, 'saving a Google Ads lead') }, { status: e instanceof ValidationError ? 400 : 500 });
  }
}
