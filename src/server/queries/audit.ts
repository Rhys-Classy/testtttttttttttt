import 'server-only';
import { and, desc, eq, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { auditLog, users } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';

const FILTER_SQL: Record<string, SQL> = {
  auth: like(auditLog.action, 'auth.%'),
  contact: eq(auditLog.entityType, 'contact'),
  invoice: eq(auditLog.entityType, 'invoice'),
  quote: eq(auditLog.entityType, 'quote'),
  payment: eq(auditLog.entityType, 'payment'),
  automation: eq(auditLog.entityType, 'automation'),
  integration: inArray(auditLog.entityType, ['integration', 'api_key']),
  access: inArray(auditLog.entityType, ['role', 'account_member', 'business_member']),
  business: inArray(auditLog.entityType, ['business', 'product']),
};

export type AuditEntry = Awaited<ReturnType<typeof listAudit>>['rows'][number];

/**
 * Newest first, 50 at a time (keyset on created_at). RLS decides what's visible:
 * businesses where the user has audit.view, plus account-level entries for the owner.
 */
export async function listAudit(ctx: AppContext, opts: { filter?: string; before?: string | null; entityId?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 100);
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : null;
  const rows = await readScope(ctx, (tx) => tx
    .select({
      id: auditLog.id, createdAt: auditLog.createdAt, subAccountId: auditLog.subAccountId, action: auditLog.action,
      entityType: auditLog.entityType, entityId: auditLog.entityId, entityLabel: auditLog.entityLabel, data: auditLog.data,
      actor: auditLog.actor, actorLabel: auditLog.actorLabel, actorName: users.name, ip: auditLog.ip,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(
      ctx.current
        ? eq(auditLog.subAccountId, ctx.current.id)
        : or(sql`${auditLog.subAccountId} = any(${pgArray(ctx.scopeIds)})`, isNull(auditLog.subAccountId)),
      opts.filter && FILTER_SQL[opts.filter] ? FILTER_SQL[opts.filter] : undefined,
      opts.entityId ? eq(auditLog.entityId, opts.entityId) : undefined,
      before ? lt(auditLog.createdAt, before) : undefined,
    ))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1));
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { rows: page, nextBefore: more ? page[page.length - 1].createdAt.toISOString() : null };
}
