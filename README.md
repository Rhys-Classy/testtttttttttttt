# Business OS

One login. Every business. A calm screen that tells you what needs you **now**, what's on **today**, and where the **money** is.

Built for an owner running several businesses (trades, retail, agency, care, manufacturing) who wants the useful parts of GoHighLevel + simple Xero-style invoicing + Stripe + a CRM, without the clutter.

```
Master account (one login)
│
├── Classy Kitchen Facelifts ──┬─ contacts, leads, pipeline, quotes, jobs, invoices, payments …
│                              └─ its own Stripe · email · SMS · calendar · automations
├── Classy Clothing Co ────────── its own data + integrations
├── Madd Marketing & Automations  its own data + integrations
├── Gippy Disability Support ──── its own data + integrations ("Clients" instead of "Contacts")
└── Gippy Custom Furniture ────── its own data + integrations
```

The five businesses are **seed data**, not code. Add, rename or archive businesses in *Settings → Businesses*.

---

## What's in it

| Area | What you get |
|---|---|
| **Home** | *Now* (overdue invoices, failed payments, unanswered messages, new leads, stale quotes, jobs tomorrow), *Today* (one-tap tasks, appointments, jobs, follow-ups), *Money* (paid today, month, outstanding, overdue, next 7 days), *Pipeline*, big quick-action buttons, and a card per business in *All Businesses* view |
| **Command centre** `Ctrl/⌘ K` | Natural language: *"Create invoice for John for $2,500 plus GST"*, *"Create task to call Steve tomorrow"*, *"Book meeting with John Friday at 2pm"*, *"Show overdue invoices"*, *"Show leads from Facebook"*, *"Open Classy Kitchen Facelifts"*. Asks which one when a name exists in two businesses. Financial actions create **drafts** for review |
| **Quick add** `+` | Contact, lead, deal, task, appointment, quote, invoice, payment, note, job — minimal fields |
| **CRM** | Contacts + companies, tags, custom fields, timeline, notes, call log, documents, per-business terminology |
| **Leads & pipeline** | Lead sources/statuses, convert to deal, unlimited pipelines, drag-and-drop kanban + list |
| **Quotes** | Line items, products, discounts, GST inc/ex, online **accept** → auto job + (deposit) invoice + deal won |
| **Invoices & payments** | Tax Invoice layout, ABN checks, Stripe **Pay Now**, manual payments, partial payments, overdue sweep, automatic reminders, receipts, refunds |
| **Jobs** | Customer → deal → quote → job → invoice → payment, status stepper, photos, notes, schedule |
| **Calendar** | Day / week / month; appointments, jobs, timed tasks; reminders sent automatically 24h before |
| **Tasks — My Day** | One-click complete, snooze 1h / tomorrow / next week, recurrence, priorities, *all businesses* view with a business badge on every task |
| **Inbox** | Email, SMS, call log; assign, internal notes, snooze, close, make task/deal; templates; scheduled sending; STOP/START opt-out |
| **Marketing** | Segmented email/SMS campaigns, drag-and-drop form builder with public links + embed code, landing pages |
| **Automations** | Visual builder: triggers (new lead, form, deal stage, quote accepted, invoice overdue/paid, payment failed, appointment booked/cancelled, tag, reply, job status, schedule…) → wait, email, SMS, task, tag, field, move deal, invoice, quote, appointment, notify, webhook, HTTP, if/else, stop. Stop-on-reply. 8 ready-made templates |
| **Reports** | Revenue (12-month chart), sales, leads by source, customers, campaigns — per business or combined, AU financial-year presets |
| **AI assistant** | *"What should I do today?"*, *"Who owes me money?"*, *"Which business has the most overdue invoices?"* — runs only through permission-checked tools; invoices/quotes/bookings/messages wait for your **Confirm** tap |
| **Mobile** | Bottom nav (Home · Inbox · Tasks · Calendar · Contacts · More), thumb-sized targets, no horizontal scrolling |

---

## Data isolation (the important bit)

```
request ──► session cookie ──► user
                │
                ▼
   BEGIN;  SET LOCAL app.user_id, app.actor, app.sub_account_ids   ◄── one transaction per unit of work
                │
                ▼
   Postgres row level security on every business-owned table:
     visible rows  = sub_account_id ∈ (requested ∩ businesses the user is a member of)
     writes        = …and the membership isn't read-only
     system/public = pinned to exactly ONE business
                │
                ▼
   composite FKs (sub_account_id, x_id) → a row can never point at another business's row
```

- The app connects as **`bos_app`**: not a superuser, no `BYPASSRLS`, owns no tables. Every query is filtered by the database, not by the UI.
- Business membership is checked **inside Postgres** (`app.visible_sub_account_ids()`), so a forged business id in a cookie or form returns nothing.
- Background work (automations, webhooks, reminders) and public links (invoice, quote, form, landing page) run pinned to a **single** business resolved from an unguessable token or integration id.
- Integration secrets (Stripe keys, SMTP/Twilio passwords, the AI key) are **AES-256-GCM encrypted** at rest and never sent to the browser.
- `tests/isolation.test.ts` proves it: cross-business reads/writes, forged context, viewer read-only, FK blocking, every tenant table has RLS, integration ownership, public-token scoping.

---

## Run it locally

Needs Node 20.9+ and PostgreSQL 15+.

```bash
npm install
cp .env.example .env            # set DATABASE_URL, DATABASE_ADMIN_URL, ENCRYPTION_KEY (32+ random chars)

# once: the runtime role (not a superuser)
psql -U postgres -c "create role bos_app login password 'CHANGE_ME' nosuperuser nobypassrls"

npm run db:migrate              # schema + security layer (runs as the admin role)
npm run db:seed                 # owner login + the five businesses
npm run db:seed -- --demo       # …optionally with realistic demo data

npm run dev                     # http://localhost:3000
npm run worker                  # second terminal: automations, email/SMS delivery, reminders
```

Log in with `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from `.env` (defaults `owner@example.com` / `change-me-now` — change it in *Settings → My account*).

In development, email and SMS are printed to the worker console instead of being sent until you connect a provider.

## Self-host with Docker

```bash
cp .env.example .env    # set APP_URL, ENCRYPTION_KEY, APP_DB_PASSWORD, POSTGRES_ADMIN_PASSWORD, SEED_OWNER_*
docker compose up -d    # db → migrate+seed → app (port 3000) + worker
```

Put it behind HTTPS (Caddy, Cloudflare Tunnel, nginx). `APP_URL` must be the public https URL — it's used in invoice/quote links and webhook URLs.

---

## Connecting each business

*Settings → Integrations* (open the business first — each one has its own):

| Integration | Setup |
|---|---|
| **Stripe** | Paste the secret (or restricted) key. Copy the webhook URL shown into Stripe → Developers → Webhooks, events `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and paste the signing secret back. Invoices then get **Pay Now**. Webhooks are signature-verified and idempotent; payment status never relies on the browser redirect |
| **Email (SMTP)** | Google Workspace/Gmail app password (`smtp.gmail.com:465`), Microsoft 365 (`smtp.office365.com:587`) or any transactional provider |
| **SMS (Twilio)** | Account SID, auth token, number. Set the shown URL as the number's incoming-message webhook — replies land in the Inbox, STOP opts out |
| **Website forms** | POST any form (WordPress, Webflow, GoHighLevel, Zapier) to the shown URL — creates a lead + contact and fires *Form submitted* automations |
| **AI assistant** | Account-wide (*Whole account* section): Claude API key |
| Gmail / Google Calendar OAuth, Microsoft, Facebook/Instagram | Provider slots and interfaces are in place (`src/lib/integrations`); marked *coming soon* in the UI |

---

## Project layout

```
drizzle/                    SQL migrations (0000 schema, 0001 security: roles, RLS, tenant FKs, SECURITY DEFINER entry points)
src/db/                     schema (Drizzle), context (withContext / withSystem / withPublic), seed
src/lib/                    tax (GST layer), dates (timezones), money, commands (NL parser), automation types,
                            integrations (Stripe, SMTP, Twilio), modules registry, crypto, storage
src/server/services/        domain logic — every function takes (tx, scope) and emits events/activities
src/server/queries/         read models: dashboard, search, reports
src/server/actions/         server actions (auth + business check, then a service)
src/server/assistant/       AI assistant: tool definitions + tool loop
src/worker/                 background worker
src/app/(app)/              the app       src/app/(public)/   invoice, quote, form, landing page
tests/                      isolation, flows (quote→job→invoice, Stripe webhooks, automations…), unit, command parser
```

## Checks

```bash
npm run typecheck
npm test          # needs a test database: TEST_DATABASE_URL / TEST_DATABASE_ADMIN_URL (defaults to localhost bos_test)
npm run build
```

---

## Status

| | |
|---|---|
| ✅ Built and tested | Everything in *What's in it* above, multi-business isolation, Stripe (per-business keys, Checkout, webhooks, refunds), SMTP email, Twilio SMS, website webhook, AI assistant, worker, Docker, CI |
| 🔌 Architected, needs credentials/app registration | Gmail + Google Calendar OAuth, Microsoft 365 mail/calendar, Facebook Messenger / Lead Ads, Instagram DMs, S3 storage, Stripe Connect onboarding flow (connected-account id already supported) |
| 🗺️ Next | Per-message email open/click tracking, two-way calendar sync, PDF files attached to emails (customers currently get a link with a print-to-PDF view), Shopify order sync for retail |
