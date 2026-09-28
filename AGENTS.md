<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Business OS — working notes

Multi-business management app: one master account, many business sub-accounts. Read README.md first.

## Rules that keep businesses isolated (do not break)

- Every business-owned table has `sub_account_id uuid not null` (use `subAccountId()` from `src/db/schema/tenant.ts`) plus `uniqueIndex(<table>_tenant_uq).on(subAccountId, id)`.
- New business-owned tables need, in a new custom migration (`npx drizzle-kit generate --custom`): RLS enabled, the `tenant_isolation` policy and the three restrictive `tenant_write_*` policies (copy the loop in `drizzle/0001_security.sql`), and composite `(sub_account_id, x_id)` foreign keys via the same pattern. `tests/isolation.test.ts` fails if any public table lacks RLS.
- Never query outside a context. Use `withContext` / `withSystem(subAccountId)` / `withPublic(subAccountId)` from `src/db/context.ts`, or in the app `readScope(ctx, …)` / `inBusiness(ctx, subAccountId, …)` from `src/server/context.ts`.
- The runtime connection (`DATABASE_URL`) must be the non-superuser `bos_app` role. `DATABASE_ADMIN_URL` is only for migrations/seed.
- Pre-auth, worker and public lookups go through the narrow `app.*` SECURITY DEFINER functions (auth_find_user, auth_session, resolve_public, resolve_integration, claim_events, claim_workflow_runs, active_sub_account_ids, next_number). Don't add broad ones.
- Integration secrets: only via `src/server/services/integrations.ts` (encrypted). Never return `secretsEncrypted` or decrypted values to a client component.

## Conventions

- Services in `src/server/services/*` take `(tx, scope)`, write activities with `logActivity`, and emit outbox events with `emit` (automations run from those in the worker). No network calls inside a transaction — queue messages with `queueMessage`; the worker delivers.
- Money is integer cents. GST/tax maths only through `src/lib/tax` (`calculateDocument`). Dates: business timezone via `src/lib/dates` (default Australia/Melbourne), never the server's local time.
- A transaction is one connection: don't `Promise.all` queries on a `tx` — use `sequential()` from `src/db/sequential.ts`.
- `= any(...)` with a JS array: use `pgArray(ids)` from `src/db/sql.ts` (drizzle expands arrays into tuples otherwise).
- Business names are data. Never branch on a business name; use modules (`src/lib/modules/registry.ts`), terminology and settings.
- UI: calm lists over tables, large targets, every cross-business item shows `<BusinessBadge>`, one-tap actions, financial actions create drafts or ask for confirmation.
- Checks before pushing: `npm run typecheck && npm test && npm run build`.
