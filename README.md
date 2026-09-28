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
| **Team & roles** | Owner, Admin, Manager, Staff (only what's assigned to them), Accountant, Viewer + your own roles. Editable permissions. Access to one, several or all businesses |
| **Security** | Two-step verification (authenticator app + recovery codes, can be required for everyone), device list + sign-out, idle timeout, audit log of who changed what |
| **REST API** | Per-business API keys with their own permissions for Zapier / your website, plus a calendar feed (see API.md) |
| **Easy on the eyes** | Dark theme by default (soft charcoal, no pure white), light or match-device in *My account* |

---

## Data isolation and permissions (the important bit)

```
request ──► proxy (CSRF, headers) ──► session (+ two-step) ──► user + role per business
                │
                ▼
   BEGIN;  SET LOCAL app.user_id, app.actor, app.sub_account_ids   ◄── one transaction per unit of work
                │
                ▼
   Postgres row level security on every business-owned table:
     visible rows  = business ∈ (requested ∩ the user's businesses)  AND  role has the view permission
                     (Staff: only rows assigned to them)
     writes        = app.has_permission(business, 'invoices.edit') checked in the database first,
                     then the work runs pinned to exactly ONE business, logged against the user
                │
                ▼
   composite FKs (sub_account_id, x_id) → a row can never point at another business's row
   audit triggers → append-only history of every important change
```

- The app connects as **`bos_app`**: not a superuser, no `BYPASSRLS`, owns no tables, can't read password hashes or MFA secrets.
- Membership **and permissions** are checked **inside Postgres**, so a forged business id or a missing permission returns nothing.
- Background work and public links run pinned to a **single** business resolved from an unguessable token, integration id or API key.
- Integration secrets are **AES-256-GCM encrypted** at rest and never sent to the browser.
- Proven by tests: `isolation.test.ts` (Business A can never reach Business B), `permissions.test.ts` (roles, Staff assigned-only, no privilege escalation, tamper-proof audit), `api.test.ts` (keys, CSRF, headers), `auth.test.ts` (TOTP vectors, replay, recovery codes, sessions).

Full details: **ARCHITECTURE.md** · **DATABASE.md** · **API.md** · **INTEGRATIONS.md** · **ROADMAP.md**.

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

## Host on Netlify (and install on your phone)

`netlify.toml` is included. Netlify builds the Next.js app, provisions **Netlify Database** (Postgres) automatically, applies `netlify/database/migrations` before each deploy goes live, stores uploads in **Netlify Blobs**, and runs the background jobs with a scheduled function (`netlify/functions/worker-tick.mts`, every 2 minutes).

Environment variables (Project configuration → Environment variables):

| Variable | Value |
|---|---|
| `APP_URL` | `https://<site>.netlify.app` (or your domain) |
| `ENCRYPTION_KEY` | 48+ random characters (secret) — never change it once integrations are connected |
| `APP_DB_PASSWORD` | 30+ random characters (secret) — the app's restricted database login |
| `CRON_SECRET` | 32+ random characters (secret) |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_OWNER_NAME` | first login, created on the first sign-in attempt while the database is empty |
| `STORAGE_DRIVER` | `netlify-blobs` |

How the database stays locked down on Netlify: the platform gives the app the database owner's connection. The app uses it only to switch on its own restricted `bos_app` login (first request after a deploy) and to create the first owner on an empty database; every page and API request then runs as `bos_app`, so row level security applies exactly as on a self-hosted server.

After changing `drizzle/` run `npm run netlify:migrations` (a test fails if the two drift).

**Install on a phone:** open the site → iPhone: Safari → Share → *Add to Home Screen*; Android: Chrome → ⋮ → *Install app*. It opens full screen with its own icon; if you're offline it shows a calm offline screen (pages are never cached on the phone).

## Connecting each business

*Settings → Integrations* (open the business first — each one has its own Stripe, email, SMS and website-form connection; the AI key is account-wide). Step-by-step setup and what's built vs planned: **INTEGRATIONS.md**.

## First things to do after logging in

1. *My account* → turn on **two-step verification**, then (owner) tick **Require two-step verification** for everyone.
2. *Team* → add people with a role per business (e.g. your Head Installer as **Staff** in Classy Kitchen Facelifts only).
3. *Settings → Integrations* per business → Stripe, email, SMS.

---

## Project layout

```
drizzle/                    SQL migrations (0000 schema, 0001 security, 0002 roles/MFA/API keys, 0003 permissions + audit triggers, 0004 retries)
src/db/                     schema (Drizzle), context (withContext / withSystem / withPublic), seed
src/lib/                    tax (GST layer), dates (timezones), money, commands (NL parser), automation types,
                            integrations (Stripe, SMTP, Twilio), modules registry, crypto, storage
src/server/services/        domain logic — every function takes (tx, scope) and emits events/activities
src/server/queries/         read models: dashboard, search, reports
src/server/actions/         server actions (auth + business check, then a service)
src/server/assistant/       AI assistant: tool definitions + tool loop
src/worker/                 background worker
src/app/(app)/              the app       src/app/(public)/   invoice, quote, form, landing page
tests/                      isolation, permissions, auth/MFA, API/CSRF, flows (quote→job→invoice, Stripe, automations…), unit, command parser
```

## Checks

```bash
npm run typecheck
npm test          # needs a test database: TEST_DATABASE_URL / TEST_DATABASE_ADMIN_URL (defaults to localhost bos_test)
npm run build
```

---

## Status

See **ROADMAP.md** for the per-feature Definition-of-Done table and what is clearly not built yet (Gmail/Microsoft OAuth, two-way calendar sync, Facebook/Instagram, password-reset emails, email tracking).
