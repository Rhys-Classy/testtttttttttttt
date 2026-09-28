import { sql } from 'drizzle-orm';
import { db, type Tx } from './client';

/**
 * Database context for one unit of work. Everything that touches business data
 * runs inside `withContext`, which opens a transaction and sets the
 * transaction-local settings that row level security reads.
 *
 *  - `user`: a logged-in person. `subAccountIds` is what the request is asking to
 *    see (one business, or all of them). The database intersects it with the
 *    user's real memberships AND role permissions, so a forged id or a missing
 *    permission returns nothing.
 *  - `system`: work pinned to exactly ONE business. Used by background jobs
 *    (automations, webhooks, reminders) and by user actions AFTER the database
 *    has confirmed the user's permission (see server/context.ts `inBusiness`).
 *    `userId`/`auditActor` only attribute the change in the audit log.
 *  - `public`: unauthenticated visitors (public invoice, quote, form). Pinned to
 *    exactly one business, resolved from an unguessable token.
 */
export type AuditActor = 'user' | 'system' | 'public' | 'api';

export type DbContext =
  | { actor: 'user'; userId: string | null; subAccountIds: string[]; ip?: string | null }
  | {
      actor: 'system' | 'public';
      subAccountId: string;
      /** Who caused it, for the audit log. */
      userId?: string | null;
      auditActor?: AuditActor;
      /** e.g. an API key name, "Customer (online)". */
      label?: string | null;
      ip?: string | null;
    };

export async function applyContext(tx: Tx, ctx: DbContext) {
  const userId = ctx.userId ?? '';
  const ids = ctx.actor === 'user' ? ctx.subAccountIds : [ctx.subAccountId];
  for (const id of ids) assertUuid(id);
  if (userId) assertUuid(userId);
  const auditActor = ctx.actor === 'user' ? 'user' : (ctx.auditActor ?? ctx.actor);
  const label = ctx.actor === 'user' ? '' : (ctx.label ?? '').slice(0, 120);
  await tx.execute(sql`select
    set_config('app.actor', ${ctx.actor}, true),
    set_config('app.user_id', ${userId}, true),
    set_config('app.sub_account_ids', ${ids.join(',')}, true),
    set_config('app.audit_actor', ${auditActor}, true),
    set_config('app.actor_label', ${label}, true),
    set_config('app.client_ip', ${(ctx.ip ?? '').slice(0, 64)}, true)`);
}

export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await applyContext(tx, ctx);
    return fn(tx);
  });
}

export const withSystem = <T>(subAccountId: string, fn: (tx: Tx) => Promise<T>) =>
  withContext({ actor: 'system', subAccountId }, fn);

export const withPublic = <T>(subAccountId: string, fn: (tx: Tx) => Promise<T>, label = 'Customer (online)') =>
  withContext({ actor: 'public', subAccountId, label }, fn);

/** No user, no business: only the SECURITY DEFINER entry points return anything. */
export const withAnonymous = <T>(fn: (tx: Tx) => Promise<T>) =>
  withContext({ actor: 'user', userId: null, subAccountIds: [] }, fn);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
function assertUuid(v: string) {
  if (!isUuid(v)) throw new Error('Invalid id in database context');
}
