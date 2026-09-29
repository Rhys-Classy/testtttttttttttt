# Integrations

## Ownership

| Scope | Examples | Stored as | Who can change it |
|---|---|---|---|
| **Business** (`scope = 'sub_account'`) | Stripe, email, SMS, website forms, Google Ads lead forms, calendars | `integrations` row with `sub_account_id` — DB check constraint forces it | people with `integrations.manage` in that business |
| **Account-wide** (`scope = 'global'`) | AI assistant (Claude) | `integrations` row with no business | account owner |

Secrets (API keys, passwords, webhook secrets) are AES-256-GCM encrypted with `ENCRYPTION_KEY` and never leave the server; screens only show the last 4 characters. Changes appear in the audit log ("Connected Stripe", "Updated Stripe settings: credentials changed") without values.

## Status

| Integration | Status | Setup |
|---|---|---|
| **Stripe** (per business, Connect-capable) | ✅ Built | Paste a secret or restricted key. In Stripe → Developers → Webhooks, add the URL shown (`/api/webhooks/stripe/<id>`) with events `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`; paste the signing secret back. Invoices get **Pay Now**. Payments are only marked paid from a verified webhook (never the browser redirect); duplicate webhooks are ignored. Refunds go through Stripe and are confirmed by webhook |
| **Email (SMTP)** | ✅ Built | Google Workspace/Gmail app password (`smtp.gmail.com:465`), Microsoft 365 (`smtp.office365.com:587`) or any transactional provider |
| **SMS (Twilio)** | ✅ Built | Account SID, auth token, number. Set `/api/webhooks/twilio/<id>` as the number's incoming webhook — replies land in the Inbox; STOP/START handled |
| **Website forms** | ✅ Built | POST JSON or form data to `/api/webhooks/website/<id>?token=…` — creates contact + lead and fires automations |
| **Google Ads lead forms** | ✅ Built | Settings → Integrations → Advertising → Connect (optional typical job value). In Google Ads: lead form asset → *Lead delivery* → *Webhook integration*, paste the URL (`/api/webhooks/google-ads/<id>`) and key, click **Send test data** (you get a "Google Ads connected" notification; test data creates nothing). Each real lead: contact matched or created, lead (source `google`), deal in the first stage of the default pipeline, *New lead* automations. Duplicate deliveries ignored (by `lead_id`); `gclid`/campaign/form ids kept on the lead for later conversion reporting |
| **REST API** | ✅ Built | Settings → API keys (see API.md) — Zapier, GoHighLevel webhooks, scripts |
| **Calendar feed (ICS)** | ✅ Built | `/api/v1/calendar.ics?key=…` with a `calendar.view`-only key; subscribe from Google/Apple/Outlook |
| **AI assistant (Claude)** | ✅ Built | Settings → Integrations → Whole account: API key. Optional model override; defaults to `AI_MODEL` |
| Gmail API (send as the mailbox) | 🔌 Provider class exists; OAuth flow **not built** | needs a Google Cloud OAuth app |
| Google Calendar two-way sync | ❌ Not built (interface only) | needs a Google Cloud OAuth app |
| Microsoft 365 mail / calendar | ❌ Not built | needs an Azure app registration |
| Facebook / Instagram (Messenger, Lead Ads, DMs) | ❌ Not built (interface only) | needs a Meta app + review |
| Mailchimp sync, Google Ads offline conversion upload | ❌ Not built (interface only) | |

## Provider abstractions

All in `src/lib/providers/` (index re-exports everything):

```ts
interface PaymentProvider  { createCheckout(input); refund(providerPaymentId, amountCents?); verifyWebhook(payload, signature) }   // Stripe
interface EmailProvider    { send({ to, subject, text, html?, fromName?, replyTo? }) }                                              // SMTP, SMTP URL, Gmail API, Log
interface SMSProvider      { send({ to, body }) }                                                                                   // Twilio, Log
interface CalendarProvider { feed?(name, events, tz); pushEvent?(event); listBusy?(from, to) }                                      // ICS (feed); Google/Microsoft = not_implemented
interface MarketingProvider{ syncAudience?(…); fetchLeads?(since) }                                                                 // all not_implemented
interface AIProvider       { createMessage(params) }                                                                                // Anthropic
```

In development (no provider connected) email and SMS go to the **Log** providers — printed by the worker, nothing sent. In production a missing provider is an error on the message ("No email provider connected for this business").

### Delivery and retries

Messages are queued inside the business transaction and sent by the worker outside any transaction. Transient failures (timeouts, provider 5xx) are retried after 1, 2 and 4 minutes (4 attempts); setup problems (no provider, bad credentials, no address, opted out) fail immediately with the reason shown on the message.

### Adding a provider

1. Implement the interface in `src/lib/providers/` or `src/lib/integrations/`.
2. Add it to `src/lib/integrations/catalog.ts` (fields, which are secret, scope, status).
3. Resolve it in the relevant service (`delivery.ts` for email/SMS) from the business's encrypted credentials.
4. If it has webhooks, add `/api/webhooks/<provider>/[integrationId]` that resolves the business with `app.resolve_integration` and verifies the provider's signature before touching data.
