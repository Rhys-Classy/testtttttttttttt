import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { isUuid, withAnonymous, withSystem } from '@/db/context';
import { handleStripeWebhook } from '@/server/services/stripe';

/**
 * Each business has its own Stripe account and webhook: /api/webhooks/stripe/<integration id>.
 * The signature is verified with THAT business's signing secret, the event is stored with a
 * unique (provider, event id) so retries are no-ops, and everything runs pinned to one business.
 */
export async function POST(req: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  if (!isUuid(integrationId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const subAccountId = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string | null }>(sql`select app.resolve_integration(${integrationId}::uuid) as id`)).rows[0]?.id ?? null);
  if (!subAccountId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const raw = await req.text();
  try {
    const result = await withSystem(subAccountId, (tx) =>
      handleStripeWebhook(tx, { subAccountId, userId: null, actor: 'system' }, integrationId, raw, req.headers.get('stripe-signature')));
    return NextResponse.json({ received: true, status: result.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    const isSig = /signature|webhook secret|No signatures/i.test(msg);
    console.error('[stripe webhook]', msg);
    return NextResponse.json({ error: isSig ? 'Invalid signature' : 'Processing failed' }, { status: isSig ? 400 : 500 });
  }
}
