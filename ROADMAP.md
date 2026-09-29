# Roadmap and status

Honest status. ✅ done and tested · 🟡 works, with a stated gap · ❌ not built.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Master account, businesses, switcher, login, sessions, **two-step verification**, **roles & permissions**, **audit log**, row level security, dark theme, error/loading/empty states | ✅ |
| 2 CRM | Contacts, companies, tags, custom fields, timeline, notes, documents, leads, pipelines, deals | ✅ |
| 3 Sales & money | Products, quotes with online accept, invoices (AU GST), Stripe Pay Now, payments, refunds, receipts, overdue reminders | ✅ |
| 4 Work | Tasks (My Day, snooze, recurrence), calendar, jobs, staff | ✅ |
| 5 Communication | Unified inbox (email/SMS/call log), templates, scheduled sends, opt-out, retries | 🟡 email + SMS only; Facebook/Instagram/Gmail OAuth not built |
| 6 Marketing | Segments, email/SMS campaigns, forms, landing pages | 🟡 no open/click tracking |
| 7 Automation | Visual builder, triggers, waits, if/else, stop-on-reply, templates | ✅ |
| 8 Reporting | Revenue, sales, leads, customers, campaigns; AU financial year | ✅ |
| 9 AI | Assistant with permission-filtered tools and confirm-before-write, cross-business answers | 🟡 no scheduled AI summaries / task suggestions yet |
| — | REST API v1 with keys, calendar feed | ✅ read + create for contacts/leads/tasks; invoices/payments read-only |
| — | Lead sources: website webhook, Google Ads lead forms (→ contact + lead + pipeline deal) | ✅ |

## Definition of Done by feature

Columns: UI · backend · database · validation · permissions · error handling · loading · empty states · mobile · tests · docs.

| Feature | UI | BE | DB | Valid. | Perms | Errors | Load | Empty | Mobile | Tests | Docs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Businesses & switcher | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ isolation | ✅ |
| Login, sessions, idle timeout, device list | ✅ | ✅ | ✅ | ✅ zod | ✅ | ✅ | ✅ | — | ✅ | ✅ auth | ✅ |
| Two-step verification (TOTP + recovery) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ RFC vectors, replay, e2e | ✅ |
| Roles & permissions (5 starting + custom) | ✅ | ✅ | ✅ RLS | ✅ zod | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ permissions | ✅ |
| Team (per-business / all-business access) | ✅ | ✅ | ✅ | ✅ zod | ✅ no escalation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit log + record history | ✅ | ✅ | ✅ triggers | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| API keys + REST API v1 | ✅ | ✅ | ✅ | ✅ zod | ✅ per key | ✅ | ✅ | ✅ | ✅ | ✅ api | ✅ API.md |
| Contacts / companies / custom fields | ✅ | ✅ | ✅ | 🟡 service checks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leads & pipeline | ✅ | ✅ | ✅ | 🟡 service checks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quotes (online accept → job/invoice) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ flows | ✅ |
| Invoices, GST, numbering | ✅ | ✅ | ✅ | ✅ ABN, tax | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ unit + flows | ✅ |
| Stripe payments, webhooks, refunds | ✅ | ✅ | ✅ | ✅ signatures | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ flows | ✅ |
| Tasks / calendar / jobs / staff | ✅ | ✅ | ✅ | 🟡 service checks | ✅ Staff = assigned only | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Inbox, email/SMS delivery + retries | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Campaigns / forms / landing pages | ✅ | ✅ | ✅ | ✅ zod | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Automations | ✅ | ✅ | ✅ | ✅ zod | ✅ | ✅ | ✅ | ✅ | 🟡 builder is desktop-first | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ | ✅ | ✅ money needs `reports.financial`/`invoices.view` | ✅ | ✅ | ✅ | ✅ | 🟡 no dedicated test | ✅ |
| AI assistant | ✅ | ✅ | — | ✅ zod | ✅ tools filtered by role | ✅ | ✅ | ✅ | ✅ | 🟡 needs an API key to test live | ✅ |
| Command centre (natural language) | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ parser | ✅ |

"Service checks" = inputs are checked in the domain services (required fields, amounts, linked records must be in the same business) rather than a zod schema per form. Moving every form to shared zod schemas is on the list below.

## Not built yet (clearly)

- Gmail / Microsoft 365 OAuth mailboxes, Google/Microsoft two-way calendar sync, Facebook/Instagram inbox + Lead Ads, Mailchimp sync (interfaces exist; see INTEGRATIONS.md)
- Email open/click tracking; PDF attachments on emails (customers get a link with a print-to-PDF view)
- Shopify order sync for retail
- Password reset by email (owners reset team passwords by re-inviting; the owner's own reset is `npm run db:seed` with new `SEED_OWNER_PASSWORD`)
- Invites by email link (currently a temporary password the owner shares)
- WebAuthn / passkeys (TOTP is in)
- Shared rate-limit store (Redis/Blobs) — the in-memory limiter is per server instance, which on Netlify means per function instance (weaker)
- Instant email/SMS sending on Netlify: messages go out on the next 2-minute worker run (self-host: within seconds)
- Push notifications on the installed phone app
- API: create/send invoices, record payments, webhooks out (subscriptions)
- AI: scheduled summaries, suggested tasks, cross-business weekly briefing
- Google Ads offline conversions (send won deals back to Google using the stored `gclid`)
- Field-level permissions (e.g. hide cost prices from Staff) — permissions are per module/action today

## Next up (recommended order)

1. Password reset + email invites (needs a system email sender)
2. Gmail OAuth (most businesses already live in Gmail)
3. Shared zod schemas for every server action form
4. AI weekly briefing per business
5. Outbound webhooks from the API (Zapier triggers)
