import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { contacts, webhookEvents } from '@/db/schema';
import { balanceDue, getInvoice, recordFailedPayment, recordProviderPayment, recordRefund } from './finance';
import { getBusinessCredentials } from './integrations';
import { ValidationError, byTenant, getBusiness, type Scope } from './_common';
import { createInvoiceCheckout, stripeClient, connectOpts, verifyStripeEvent, type Stripe, type StripeCreds } from '@/lib/integrations/stripe';
import { env } from '@/lib/env';

export async function getStripeCreds(tx: Tx, scope: Scope) {
  const creds = await getBusinessCredentials<{ secretKey: string; webhookSecret?: string }>(tx, scope, ['stripe']);
  if (!creds?.secrets.secretKey) return null;
  return {
    integrationId: creds.integration.id,
    creds: { secretKey: creds.secrets.secretKey, webhookSecret: creds.secrets.webhookSecret, connectedAccountId: creds.config.connectedAccountId } as StripeCreds,
  };
}

/** "Pay Now": a Checkout session for the invoice's balance, on THIS business's Stripe account. */
export async function createPayNowSession(tx: Tx, scope: Scope, invoiceId: string) {
  const inv = await getInvoice(tx, scope, invoiceId);
  if (['paid', 'cancelled', 'draft'].includes(inv.status)) throw new ValidationError('This invoice cannot be paid online.');
  const amount = balanceDue(inv);
  if (amount <= 0) throw new ValidationError('Nothing left to pay.');
  const stripe = await getStripeCreds(tx, scope);
  if (!stripe) throw new ValidationError('Online payments are not set up for this business yet.');
  const b = await getBusiness(tx, scope.subAccountId);
  const contact = inv.contactId ? (await tx.select().from(contacts).where(byTenant(contacts, scope, inv.contactId)))[0] : null;
  const base = `${env().APP_URL}/i/${inv.publicToken}`;
  const session = await createInvoiceCheckout(stripe.creds, {
    invoiceId: inv.id, subAccountId: scope.subAccountId, number: inv.number, amountCents: amount, currency: inv.currency,
    customerEmail: contact?.email, stripeCustomerId: contact?.stripeCustomerId, businessName: b.tradingName ?? b.name,
    successUrl: `${base}?paid=1`, cancelUrl: base,
  });
  return session.url;
}

/**
 * Verified + idempotent webhook processing. The whole thing runs in one transaction:
 * if anything fails we roll back and return 500 so Stripe retries.
 */
export async function handleStripeWebhook(tx: Tx, scope: Scope, integrationId: string, rawBody: string, signature: string | null) {
  const stripe = await getStripeCreds(tx, scope);
  if (!stripe || stripe.integrationId !== integrationId) throw new ValidationError('Stripe is not connected for this business.');
  const event = verifyStripeEvent(stripe.creds, rawBody, signature);

  const inserted = await tx.insert(webhookEvents).values({
    subAccountId: scope.subAccountId, integrationId, provider: 'stripe', providerEventId: event.id, type: event.type,
    payload: event as unknown as Record<string, unknown>,
  }).onConflictDoNothing().returning();
  if (!inserted.length) {
    const [existing] = await tx.select().from(webhookEvents).where(and(
      eq(webhookEvents.subAccountId, scope.subAccountId), eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.providerEventId, event.id),
    ));
    if (existing?.processedAt) return { status: 'duplicate' as const, type: event.type };
  }

  const result = await applyStripeEvent(tx, scope, stripe.creds, event);
  await tx.update(webhookEvents).set({ processedAt: new Date() }).where(and(
    eq(webhookEvents.subAccountId, scope.subAccountId), eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.providerEventId, event.id),
  ));
  return { status: 'processed' as const, type: event.type, result };
}

function invoiceIdFrom(metadata: Stripe.Metadata | null | undefined, scope: Scope): string | null {
  if (!metadata?.invoice_id) return null;
  // Metadata must belong to this business; RLS would hide another business's invoice anyway.
  if (metadata.sub_account_id && metadata.sub_account_id !== scope.subAccountId) return null;
  return metadata.invoice_id;
}

async function chargeDetails(creds: StripeCreds, chargeId: string | null) {
  if (!chargeId) return {};
  try {
    const charge = await stripeClient(creds).charges.retrieve(chargeId, {}, connectOpts(creds));
    return {
      receiptUrl: charge.receipt_url, cardBrand: charge.payment_method_details?.card?.brand ?? null,
      cardLast4: charge.payment_method_details?.card?.last4 ?? null, method: charge.payment_method_details?.type ?? 'card',
    };
  } catch {
    return {};
  }
}

export async function applyStripeEvent(tx: Tx, scope: Scope, creds: StripeCreds, event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object;
      if (s.payment_status !== 'paid') return 'awaiting_payment';
      const invoiceId = invoiceIdFrom(s.metadata, scope);
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!invoiceId || !pi) return 'ignored';
      if (s.customer && typeof s.customer === 'string') {
        const inv = await getInvoice(tx, scope, invoiceId);
        if (inv.contactId) await tx.update(contacts).set({ stripeCustomerId: s.customer }).where(byTenant(contacts, scope, inv.contactId));
      }
      await recordProviderPayment(tx, scope, {
        invoiceId, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'aud', providerPaymentId: pi, checkoutSessionId: s.id,
      });
      return 'payment_recorded';
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const invoiceId = invoiceIdFrom(pi.metadata, scope);
      if (!invoiceId) return 'ignored';
      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
      const details = await chargeDetails(creds, chargeId);
      await recordProviderPayment(tx, scope, {
        invoiceId, amountCents: pi.amount_received || pi.amount, currency: pi.currency, providerPaymentId: pi.id, providerChargeId: chargeId, ...details,
      });
      return 'payment_recorded';
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      const invoiceId = invoiceIdFrom(pi.metadata, scope);
      if (!invoiceId) return 'ignored';
      await recordFailedPayment(tx, scope, { invoiceId, amountCents: pi.amount, currency: pi.currency, providerPaymentId: pi.id, reason: pi.last_payment_error?.message });
      return 'failure_recorded';
    }
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object;
      const invoiceId = invoiceIdFrom(s.metadata, scope);
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!invoiceId || !pi) return 'ignored';
      await recordFailedPayment(tx, scope, { invoiceId, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'aud', providerPaymentId: pi, reason: 'Bank payment failed' });
      return 'failure_recorded';
    }
    case 'charge.refunded': {
      const ch = event.data.object;
      const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id;
      if (!pi) return 'ignored';
      await recordRefund(tx, scope, { providerPaymentId: pi, refundedCents: ch.amount_refunded });
      return 'refund_recorded';
    }
    default:
      return 'ignored';
  }
}
