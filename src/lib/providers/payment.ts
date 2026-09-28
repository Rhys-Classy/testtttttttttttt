import { createInvoiceCheckout, refundPayment, verifyStripeEvent, type Stripe, type StripeCreds } from '@/lib/integrations/stripe';

/**
 * Payment provider abstraction. Stripe is implemented (per business, Connect-capable).
 * Payment status is only ever confirmed by a verified webhook, never by a browser redirect.
 */
export type CheckoutInput = Parameters<typeof createInvoiceCheckout>[1];

export interface PaymentProvider {
  readonly key: string;
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string | null }>;
  refund(providerPaymentId: string, amountCents?: number): Promise<{ id: string; status: string | null }>;
  verifyWebhook(payload: string, signature: string | null): Stripe.Event;
}

export function stripePaymentProvider(creds: StripeCreds): PaymentProvider {
  return {
    key: 'stripe',
    async createCheckout(input) {
      const s = await createInvoiceCheckout(creds, input);
      return { id: s.id, url: s.url };
    },
    async refund(providerPaymentId, amountCents) {
      const r = await refundPayment(creds, providerPaymentId, amountCents);
      return { id: r.id, status: r.status };
    },
    verifyWebhook: (payload, signature) => verifyStripeEvent(creds, payload, signature),
  };
}
