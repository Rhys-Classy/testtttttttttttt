import Stripe from 'stripe';

export type StripeCreds = { secretKey: string; webhookSecret?: string; connectedAccountId?: string };

export function stripeClient(creds: StripeCreds) {
  return new Stripe(creds.secretKey, { appInfo: { name: 'Business OS' }, maxNetworkRetries: 2 });
}

/** Request options that route calls to a connected account when Stripe Connect is used. */
export function connectOpts(creds: StripeCreds): Stripe.RequestOptions | undefined {
  return creds.connectedAccountId ? { stripeAccount: creds.connectedAccountId } : undefined;
}

export async function createInvoiceCheckout(creds: StripeCreds, input: {
  invoiceId: string;
  subAccountId: string;
  number: string;
  amountCents: number;
  currency: string;
  customerEmail?: string | null;
  stripeCustomerId?: string | null;
  businessName: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = stripeClient(creds);
  const metadata = { invoice_id: input.invoiceId, sub_account_id: input.subAccountId, invoice_number: input.number };
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: input.stripeCustomerId ?? undefined,
    customer_email: input.stripeCustomerId ? undefined : (input.customerEmail ?? undefined),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: input.currency.toLowerCase(),
        unit_amount: input.amountCents,
        product_data: { name: `Invoice ${input.number}`, description: input.businessName },
      },
    }],
    payment_intent_data: { metadata, description: `Invoice ${input.number}` },
    metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  }, {
    ...connectOpts(creds),
    // Same invoice + amount within the idempotency window returns the same session.
    idempotencyKey: `checkout:${input.invoiceId}:${input.amountCents}:${Math.floor(Date.now() / 600_000)}`,
  });
}

export function verifyStripeEvent(creds: StripeCreds, payload: string, signature: string | null): Stripe.Event {
  if (!creds.webhookSecret) throw new Error('Stripe webhook secret is not configured for this business.');
  if (!signature) throw new Error('Missing Stripe-Signature header.');
  return stripeClient(creds).webhooks.constructEvent(payload, signature, creds.webhookSecret);
}

export async function refundPayment(creds: StripeCreds, paymentIntentId: string, amountCents?: number) {
  return stripeClient(creds).refunds.create({ payment_intent: paymentIntentId, amount: amountCents }, connectOpts(creds));
}

export type { Stripe };
