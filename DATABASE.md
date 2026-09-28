# Database

PostgreSQL 15+ (uses `ON DELETE SET NULL (column)`). UUID primary keys everywhere. Money in integer cents. Timestamps are `timestamptz`.

## Shape

```
accounts ─┬─ account_members ── users ── sessions
          │        │ all_businesses_role_id
          ├─ roles ◄┘◄───────────────┐
          ├─ integrations (scope=global, e.g. AI key)
          ├─ audit_log (account-level rows: sign-ins, team, roles)
          └─ sub_accounts (businesses)
                ├─ sub_account_members (user → role_id in this business)
                ├─ integrations (scope=sub_account)      ├─ api_keys
                └─ business data (every row has sub_account_id):
                   companies, contacts, notes, activities, custom_field_definitions,
                   leads, pipelines, pipeline_stages, deals, staff_members,
                   products, quotes (+lines), invoices (+lines), payments, orders, webhook_events,
                   tasks, appointments, jobs, documents,
                   conversations, messages, message_templates, campaigns (+recipients),
                   forms, form_submissions, landing_pages, workflows, workflow_runs,
                   events (outbox), notifications, audit_log
```

## Tenant rules

1. Every business-owned table has `sub_account_id uuid not null` → `sub_accounts(id) on delete cascade`, and a unique index `(sub_account_id, id)`.
2. References between business rows are **composite** foreign keys `(sub_account_id, x_id) → x(sub_account_id, id)`. A Classy Kitchen Facelifts invoice physically cannot point at a Classy Clothing Co contact.
3. Row level security is on for every table in `public` (a test fails otherwise).

## Access control in the database

The app connects as `bos_app` (not superuser, no BYPASSRLS, owns nothing). Each transaction sets:

| Setting | Meaning |
|---|---|
| `app.user_id` | the person (or empty) |
| `app.actor` | `user`, `system` (pinned work, incl. permitted user writes) or `public` (token links) |
| `app.sub_account_ids` | businesses the request asks for |
| `app.audit_actor`, `app.actor_label`, `app.client_ip` | attribution for the audit log only |

### Grants

`app.my_grants()` resolves, per business, the permission list and data scope:

| Membership | Result |
|---|---|
| `account_members.role = 'owner'` | `*` (everything) in every business |
| `account_members.all_businesses_role_id` | that role in every business, including ones added later |
| `sub_account_members.role_id` | that role in that business (overrides the all-businesses role) |

Roles belong to the master account (`roles`: `permissions text[]`, `data_scope 'all' | 'assigned'`). The five starting roles are installed by a trigger on `accounts` (`app.install_default_roles`), identical to `SYSTEM_ROLES` in `src/lib/permissions.ts` (tested).

### Helper functions (all `SECURITY DEFINER`, `STABLE`)

| Function | Returns |
|---|---|
| `app.visible_sub_account_ids()` | requested ∩ businesses the user can open (system/public: exactly one) |
| `app.permitted_sub_account_ids(perm)` | visible businesses where the role grants `perm` |
| `app.full_sub_account_ids(perm)` / `app.assigned_sub_account_ids(perm)` | same, split by data scope |
| `app.granted_sub_account_ids(perm)` | ignores what was requested (settings screens) |
| `app.has_permission(sub, perm)` | the check `inBusiness` runs before every write |
| `app.can_grant_role(sub, role)` | you can only hand out a role whose permissions you hold |

### Policies on business tables

| Policy | Rule |
|---|---|
| `tenant_scope` (restrictive, all commands) | `sub_account_id ∈ visible` |
| `tenant_read` | `∈ full(view perm)` **or** `∈ assigned(view perm)` and the row is linked to the user |
| `tenant_insert` / `tenant_update` | `∈ permitted(edit perm)` |
| `tenant_delete` | `∈ permitted(delete perm)` |

"Linked to the user" for assigned-only roles (Staff):

| Table(s) | Visible when |
|---|---|
| tasks, jobs, appointments, deals, leads, conversations | assigned to the user |
| contacts | owner is the user, or they have an assigned job/task/appointment/deal/lead/conversation for the contact |
| notes, activities, quotes, invoices, payments, orders, campaign_recipients, form_submissions, workflow_runs | the contact is visible |
| quote/invoice line items, messages | the parent is visible |
| companies | a visible contact works there |
| documents | uploaded by the user or the contact is visible |

View/edit permission per table is listed at the top of `drizzle/0003_permissions_audit.sql`. Notifications addressed to everyone are only shown to people who can see what they're about (e.g. `invoice.*` needs `invoices.view`).

Platform tables have their own policies: `roles`, all-businesses access and removing people are owner-only; `sub_account_members` writes need `team.manage` in that business, can't touch your own row, and can't grant more than you have; `api_keys` need `integrations.manage`; global integrations are owner-only.

`users` column privileges: the app role can read `id, email, name, timezone, mfa_enabled_at, password_changed_at, last_login_at, created_at, updated_at` only. Password hashes and MFA secrets are read through `app.auth_find_user`, `app.auth_mfa_state`, `app.my_password_hash`.

### Other SECURITY DEFINER entry points

`auth_find_user`, `auth_session`, `touch_session`, `end_session`, `auth_mfa_state`, `auth_consume_totp_step`, `auth_consume_recovery_code`, `auth_api_key`, `resolve_public`, `resolve_integration`, `resolve_integration_by_address`, `active_sub_account_ids`, `claim_events`, `claim_workflow_runs`, `next_number`, `audit_auth`, `audit_write`. Each returns the minimum needed; everything after goes through RLS.

## Audit log

`audit_log(account_id, sub_account_id?, actor_user_id, actor, actor_label, action, entity_type, entity_id, entity_label, data, ip, created_at)`

- Trigger `app.audit_trigger()` on: contacts, invoices, quotes, payments, products, workflows (automations), integrations, api_keys, roles, account_members, sub_account_members, sub_accounts.
  - `x.created` / `x.deleted`; a status change becomes `x.<new status>` (`invoice.sent`, `quote.accepted`, `payment.refunded`, `automation.active`); archiving becomes `x.archived`; otherwise `x.updated` with `{changed: {field: [from, to]}}`.
  - Noise columns (timestamps, counters, tokens) are ignored; integration credentials are recorded only as "credentials changed", never values.
- `app.audit_auth()` records `auth.login`, `auth.logout`, `auth.login_failed`, `auth.mfa_*`, `auth.password_changed`, `auth.session_revoked`, `auth.recovery_code_used`.
- The app role cannot INSERT, UPDATE or DELETE `audit_log` rows directly. Readable with `audit.view` (business rows) or as owner (account rows, and everyone sees their own sign-ins).
- `src/lib/audit.ts` turns rows into sentences; `/settings/audit` and the History cards on customer/invoice pages show them.

## Migrations

| File | Contents |
|---|---|
| `0000_init.sql` | generated schema |
| `0001_security.sql` | runtime role, context helpers, RLS, tenant FKs, definer functions, grants |
| `0002_roles_mfa_audit.sql` | roles, membership changes (with data migration from the old admin/staff/viewer text roles), MFA and session columns, API keys, audit columns, assignment indexes |
| `0003_permissions_audit.sql` | grant functions, permission-aware policies, platform policies, column privileges, auth/MFA/API-key functions, audit triggers |
| `0004_message_retries.sql` | `messages.attempts` |

Run with `npm run db:migrate` (uses `DATABASE_ADMIN_URL`). Both a fresh database and an upgrade of existing data are tested.

### Adding a business-owned table

1. Define it with `subAccountId()` and `uniqueIndex('<t>_tenant_uq').on(t.subAccountId, t.id)`; `npx drizzle-kit generate`.
2. In a new custom migration (`npx drizzle-kit generate --custom`): add composite FKs, enable RLS, and create the four `tenant_*` policies with the right view/edit permission (copy the loop in `0003`). Add it to the audit trigger list if changes matter to the owner.
3. `npm test` — the isolation test fails if RLS or `tenant_scope` is missing.

## Indexes worth knowing

Every tenant table: `(sub_account_id, id)` unique. Lists: `(sub_account_id, status, …)`. Staff visibility: `(sub_account_id, assigned_user_id)` on jobs/appointments/deals/leads/conversations, `(sub_account_id, contact_id)` on the linked tables. Search: trigram GIN on contact names/email/phone and company names. Audit: `(sub_account_id, created_at)`, `(account_id, created_at)`, `(sub_account_id, entity_type, entity_id)`.
