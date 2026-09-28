import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { activities, events, subAccounts } from '@/db/schema';
import { getTaxRegime } from '@/lib/tax';

/** Who is doing the work, and in which ONE business. Every write service takes one. */
export type Scope = {
  subAccountId: string;
  userId: string | null;
  actor: 'user' | 'system' | 'public';
};

export class NotFoundError extends Error {
  constructor(what = 'Record') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The person is signed in but their role doesn't allow this. */
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function must<T>(value: T | undefined | null, what = 'Record'): T {
  if (value === undefined || value === null) throw new NotFoundError(what);
  return value;
}

export type Business = typeof subAccounts.$inferSelect;

export async function getBusiness(tx: Tx, subAccountId: string): Promise<Business> {
  const [row] = await tx.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
  return must(row, 'Business');
}

export function businessTax(b: Business) {
  const regime = getTaxRegime(b.taxRegime);
  return { regime, pricesIncludeTax: b.pricesIncludeTax, taxRegistered: b.taxRegistered };
}

export type EventType =
  | 'contact.created' | 'customer.created' | 'lead.created' | 'form.submitted'
  | 'deal.created' | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'quote.created' | 'quote.sent' | 'quote.viewed' | 'quote.accepted' | 'quote.rejected'
  | 'invoice.created' | 'invoice.sent' | 'invoice.viewed' | 'invoice.overdue' | 'invoice.paid'
  | 'payment.received' | 'payment.failed' | 'payment.refunded'
  | 'appointment.booked' | 'appointment.cancelled'
  | 'tag.added' | 'tag.removed'
  | 'message.received' | 'task.completed' | 'job.created' | 'job.status_changed'
  | 'automation.error' | 'manual';

/** Transactional outbox: the event commits (or rolls back) with the change that caused it. */
export async function emit(
  tx: Tx,
  scope: Scope,
  type: EventType,
  e: { entityType?: string; entityId?: string | null; contactId?: string | null; payload?: Record<string, unknown> } = {},
) {
  await tx.insert(events).values({
    subAccountId: scope.subAccountId,
    type,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    contactId: e.contactId ?? null,
    payload: e.payload ?? {},
    actorUserId: scope.userId,
  });
}

export async function logActivity(
  tx: Tx,
  scope: Scope,
  a: { contactId?: string | null; entityType: string; entityId?: string | null; type: string; summary: string; data?: Record<string, unknown> },
) {
  await tx.insert(activities).values({
    subAccountId: scope.subAccountId,
    contactId: a.contactId ?? null,
    entityType: a.entityType,
    entityId: a.entityId ?? null,
    type: a.type,
    summary: a.summary,
    data: a.data ?? {},
    actorUserId: scope.userId,
  });
}

/**
 * Explicit audit entry for events a table trigger can't see. Most history
 * (customers, invoices, payments, quotes, automations, integrations, team)
 * is recorded automatically by database triggers.
 */
export async function audit(tx: Tx, scope: Scope, action: string, entityType: string, entityId: string | null, label: string | null = null, data: Record<string, unknown> = {}) {
  await tx.execute(sql`select app.audit_write(${scope.subAccountId}::uuid, ${action}, ${entityType}, ${entityId}::uuid, ${label}, ${JSON.stringify(data)}::jsonb)`);
}

/** Next document number from the business's sequence (INV-1001, Q-1001...). */
export async function nextNumber(tx: Tx, scope: Scope, kind: 'invoice' | 'quote' | 'job' | 'order'): Promise<string> {
  const res = await tx.execute<{ n: string }>(sql`select app.next_number(${scope.subAccountId}::uuid, ${kind}) as n`);
  return res.rows[0].n;
}

export const byTenant = <T extends { subAccountId: unknown; id: unknown }>(table: T, scope: Scope, id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  and(eq(table.subAccountId as any, scope.subAccountId), eq(table.id as any, id));

export function cleanStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
