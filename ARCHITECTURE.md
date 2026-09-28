# Architecture

Business OS is one Next.js app + one background worker + one PostgreSQL database. It's built so a single owner can run several businesses from one login without any business ever seeing another's data.

```
                         ┌──────────────────────────── browser / phone ─────────────────────────────┐
                         │  App (dark theme)   Public links /i /q /f /p   Calendar apps   Zapier     │
                         └──────────┬──────────────────────┬──────────────────┬─────────────┬──────┘
                                    │ cookie session        │ unguessable token│ API key     │ API key
                                    ▼                       ▼                  ▼             ▼
┌─────────────────────────── Next.js 16 (App Router, standalone) ──────────────────────────────────────┐
│ proxy.ts        CSRF origin check · login gate · CSP nonce + security headers                          │
│ server/auth     sessions (sha256 tokens, idle timeout) · passwords (scrypt) · TOTP two-step · audit    │
│ server/context  AppContext = user + businesses + grants (from app.my_grants())                        │
│                 readScope(ctx)      → reads as the user, RLS filters by business + role              │
│                 inBusiness(ctx, biz, 'invoices.edit', fn, {visible})                                  │
│                    1. database checks the permission (app.has_permission)                             │
│                    2. targeted rows must be visible to the user (Staff = assigned only)               │
│                    3. same transaction continues pinned to that ONE business, attributed to the user  │
│ server/actions  form/server actions → services              server/api/v1  REST API (API keys)        │
│ server/services domain logic (tx, scope): CRM, finance, work, comms, marketing, automation            │
│ server/assistant AI tools (permission-filtered, confirm-before-write)                                 │
└───────────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                                │ bos_app (no superuser, no BYPASSRLS, owns nothing)
┌───────────────────────────────────────────────▼────────────────────────────────────────────────────────┐
│ PostgreSQL 15+   row level security on every table · composite tenant FKs · audit triggers              │
│                  transaction settings: app.user_id · app.actor · app.sub_account_ids · app.audit_actor  │
└───────────────────────────────────────────────▲────────────────────────────────────────────────────────┘
                                                │ claim_events / claim_workflow_runs (pinned per business)
┌───────────────────────────────────────────────┴────────────────────────────────────────────────────────┐
│ worker (tsx src/worker)  outbox events → automations · email/SMS delivery with retries · reminders ·   │
│                          overdue sweep · scheduled campaigns                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Stack and why

| Choice | Why |
|---|---|
| Next.js 16 App Router, React 19, TypeScript | One deployable for UI + server actions + API; server components keep data on the server |
| PostgreSQL + row level security | Isolation enforced where the data lives, not in UI code. A missed `WHERE` returns nothing instead of another business's data |
| Drizzle ORM + SQL migrations | Typed queries, readable SQL, security layer written as plain SQL (`drizzle/*.sql`) |
| zod | Every external input (forms, API bodies, query strings, AI tool calls) is validated |
| Tailwind v4 with CSS variables | Dark theme by default, light optional, all colours from tokens |
| Worker process with a transactional outbox | Automations and deliveries never run inside a web request; an event commits or rolls back with the change that caused it |
| Stripe, SMTP, Twilio, Anthropic behind provider interfaces | Swap or add providers per business without touching domain code (see INTEGRATIONS.md) |

No Redis, queue service or separate auth provider: fewer moving parts to self-host. The rate limiter is in-memory per process (fine for one server; see ROADMAP.md).

## Tenancy model

```
Master account (one login for the owner)
├── Users ── account_members (owner | member, optional all-businesses role)
├── Roles (Admin, Manager, Staff, Accountant, Viewer + custom; editable permissions)
└── Sub-accounts (businesses)
    ├── sub_account_members (person → role in THIS business)
    ├── Integrations (Stripe, email, SMS …) — owned by exactly one business
    ├── API keys — one business each
    └── Business data: contacts, leads, deals, quotes, invoices, payments, jobs, tasks, messages …
```

Businesses are data (seeded, never hard-coded). Anything business-specific is a setting: modules, terminology ("Clients" vs "Contacts"), numbering, tax regime, branding.

## Request lifecycle

1. **proxy.ts** — rejects cross-site POSTs to cookie-authenticated `/api/*`, redirects anonymous users to `/login`, sets CSP with a per-request nonce, `X-Frame-Options`, `nosniff`, HSTS (on https), referrer and permissions policies. Only `/f/*` (enquiry forms) may be framed by other sites.
2. **getSession** — hashes the cookie token, looks it up through `app.auth_session`, enforces expiry, the account's idle timeout and "require two-step verification".
3. **getAppContext** — loads the user, their businesses and grants (`app.my_grants()`), current business from the switcher cookie (validated against the grants).
4. **Reads** — `readScope(ctx, fn)` opens a transaction as the user with the businesses in view. RLS returns only rows the user's role allows (and only assigned rows for Staff).
5. **Writes** — `inBusiness(ctx, biz, permission, fn, { visible })` (see diagram). Server actions additionally get Next's built-in origin check.
6. **Errors** — domain errors (`ValidationError`, `ForbiddenError`, `NotFoundError`) become plain sentences. Anything unexpected is logged as one JSON line with a reference, and the person sees "Something went wrong while creating the invoice. Nothing was saved — please try again. (Reference 3F9A12C0)". Screens have `error.tsx` (retry), `not-found.tsx` and `loading.tsx` skeletons.

## Security summary

| Area | How |
|---|---|
| Passwords | scrypt (N=16384), per-password salt, constant-time compare, dummy hash for unknown emails |
| Sessions | 32-byte random token in an httpOnly, SameSite=Lax, Secure (on https) cookie; only sha256 stored; 30-day max; idle timeout per account; list + revoke devices; password change signs out other devices |
| Two-step verification | TOTP (RFC 6238) with QR setup, ±1 step drift, replay protection (`mfa_last_step`), 10 hashed one-time recovery codes; owner can require it for everyone |
| Brute force | per email+IP login limit, per-user code limit, per-key API limit, per-IP webhook limit |
| Authorisation | roles → permissions, checked in the database (`app.has_permission`) and enforced by RLS; UI hides what you can't use |
| Isolation | RLS on every table, restrictive `tenant_scope` policy, composite foreign keys `(sub_account_id, id)`, system work pinned to one business |
| Secrets | integration credentials AES-256-GCM encrypted at rest, never sent to the browser; password hashes and MFA secrets can't be SELECTed by the app role (column privileges) |
| CSRF | SameSite cookies + Next's server-action origin check + proxy origin check on API routes |
| XSS | React escaping, no `dangerouslySetInnerHTML` except our own QR SVG, nonce-based CSP with `strict-dynamic` |
| SQL injection | parameterised queries only (Drizzle `sql` template); `sql.identifier` for the one dynamic table name |
| Files | stored outside the web root, streamed through an access-checked route, type/size allow-list, `nosniff` |
| Webhooks | Stripe signatures verified + idempotent (`webhook_events`), Twilio signatures verified, website webhook token compared in constant time |
| Audit | database triggers + sign-in events; append-only (app role has no INSERT/UPDATE/DELETE on `audit_log`) |

## Performance

- Every list is paginated (50 rows, `?page=`); the API uses keyset cursors. Dashboards use aggregate queries, not full loads.
- Indexes on every `(sub_account_id, …)` access path, including the assigned-user columns used by Staff visibility and trigram indexes for search.
- RLS helper functions are wrapped as `(SELECT app.fn())` so Postgres evaluates them once per statement.
- Background work (automations, sends, reminders) is in the worker; web requests never wait on a provider except explicit actions like a Stripe refund.

## Code layout

```
drizzle/                 migrations: 0000 schema, 0001 security, 0002 roles/MFA/audit columns, 0003 permissions+audit triggers, 0004 retries
src/proxy.ts             CSRF, login gate, security headers
src/db/                  schema, context (withContext/withSystem/withPublic), seed
src/lib/                 permissions catalog, tax, dates, money, theme, audit wording, totp, providers/*, integrations/*
src/server/auth.ts       sessions, MFA, password
src/server/context.ts    AppContext, can(), readScope, inBusiness
src/server/services/     domain logic
src/server/queries/      read models (dashboard, search, reports, audit)
src/server/actions/      server actions (validate → inBusiness → service)
src/server/api/          REST API v1 helpers and serializers
src/app/(app)/           the app            src/app/(public)/   customer-facing pages
src/app/api/v1/          REST API           src/app/api/webhooks/ provider webhooks
src/worker/              background worker
tests/                   isolation, permissions, auth/MFA, API/CSRF/headers, flows, unit
```
