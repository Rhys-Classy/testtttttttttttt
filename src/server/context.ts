import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { applyContext, withContext } from '@/db/context';
import { accountMembers, accounts, publicUserColumns, subAccounts, users, type AccountSettings } from '@/db/schema';
import { isModuleEnabled, MODULES, type ModuleKey } from '@/lib/modules/registry';
import { grantAllows, PERMISSION_LABELS, type Grant, type Permission } from '@/lib/permissions';
import { getSession } from './auth';
import { ForbiddenError, NotFoundError, ValidationError, type Scope } from './services/_common';

export const BUSINESS_COOKIE = 'bos_business';

export type BusinessLite = typeof subAccounts.$inferSelect;

export type AppContext = {
  user: { id: string; name: string; email: string; timezone: string; mfaEnabled: boolean };
  account: { id: string; name: string; role: 'owner' | 'member'; settings: AccountSettings };
  isOwner: boolean;
  /** Every business this user can open (switcher list). */
  businesses: BusinessLite[];
  /** Selected business, or null for "All Businesses". */
  current: BusinessLite | null;
  /** Business ids this request reads from (1 when a business is selected, all when not). */
  scopeIds: string[];
  /** What the user may do in each business (resolved by the database). */
  grants: Record<string, Grant>;
  tz: string;
  ip: string | null;
};

export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
}

/** Resolved once per request. Business access and permissions come from the database, not the cookie. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session || session.needsMfaSetup) return null;
  const jar = await cookies();
  const selected = jar.get(BUSINESS_COOKIE)?.value ?? 'all';
  const ip = await clientIp();
  return withContext({ actor: 'user', userId: session.userId, subAccountIds: [], ip }, async (tx) => {
    const [user] = await tx.select(publicUserColumns).from(users).where(eq(users.id, session.userId));
    if (!user) return null;
    const [membership] = await tx.select({ account: accounts, role: accountMembers.role }).from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .where(eq(accountMembers.userId, user.id)).limit(1);
    if (!membership) return null;
    const grantRows = (await tx.execute<{ sub_account_id: string; permissions: string[]; assigned_only: boolean; role_name: string }>(
      sql`select sub_account_id, permissions, assigned_only, role_name from app.my_grants()`)).rows;
    const grants: Record<string, Grant> = {};
    for (const g of grantRows) {
      grants[g.sub_account_id] = {
        permissions: g.permissions.includes('*') ? '*' : new Set(g.permissions),
        assignedOnly: g.assigned_only,
        roleName: g.role_name,
      };
    }
    const businesses = await tx.select().from(subAccounts).where(eq(subAccounts.accountId, membership.account.id))
      .orderBy(asc(subAccounts.sortOrder), asc(subAccounts.name));
    const active = businesses.filter((b) => !b.archivedAt && grants[b.id]);
    const current = active.find((b) => b.id === selected || b.slug === selected) ?? null;
    return {
      user: { id: user.id, name: user.name, email: user.email, timezone: user.timezone, mfaEnabled: !!user.mfaEnabledAt },
      account: { id: membership.account.id, name: membership.account.name, role: membership.role, settings: membership.account.settings },
      isOwner: membership.role === 'owner',
      businesses: active,
      current,
      scopeIds: current ? [current.id] : active.map((b) => b.id),
      grants,
      tz: current?.timezone ?? user.timezone,
      ip,
    } satisfies AppContext;
  });
});

export async function requireContext(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) {
    const session = await getSession();
    redirect(session?.needsMfaSetup ? '/login/mfa-setup' : '/login');
  }
  return ctx;
}

/**
 * UI helper: may the user do `perm` in this business (or, without one, in any
 * business currently in view)? The database enforces the same rules again.
 */
export function can(ctx: AppContext, perm: Permission, subAccountId?: string | null): boolean {
  if (subAccountId) return grantAllows(ctx.grants[subAccountId], perm);
  return ctx.scopeIds.some((id) => grantAllows(ctx.grants[id], perm));
}

/** Businesses in view where the user holds `perm`. */
export function businessesWhere(ctx: AppContext, perm: Permission) {
  return (ctx.current ? [ctx.current] : ctx.businesses).filter((b) => grantAllows(ctx.grants[b.id], perm));
}

/** Only people with settings rights in at least one business see admin screens. */
export function canAdminister(ctx: AppContext) {
  return ctx.isOwner || ctx.businesses.some((b) => ['settings.manage', 'team.manage', 'integrations.manage', 'audit.view'].some((p) => grantAllows(ctx.grants[b.id], p as Permission)));
}

/** Read across whatever is selected (one business or all). RLS applies the user's permissions. */
export async function readScope<T>(ctx: AppContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.scopeIds, ip: ctx.ip }, fn);
}

type VisibleTable = 'contacts' | 'tasks' | 'jobs' | 'appointments' | 'deals' | 'leads' | 'conversations' | 'documents'
  | 'invoices' | 'quotes' | 'payments' | 'products' | 'orders' | 'workflows' | 'forms' | 'campaigns' | 'landing_pages'
  | 'staff_members' | 'messages' | 'companies';

export type InBusinessOptions = {
  /** Records the action targets: each must be visible to the user (e.g. Staff only reach their own jobs). */
  visible?: [VisibleTable, string | null | undefined][];
};

/**
 * Do something in ONE business.
 *   1. The business must be one of the user's (checked again by the database).
 *   2. The database confirms the user's role grants `perm` there (app.has_permission).
 *   3. Targeted records must be visible to the user under their role (assigned-only for Staff).
 *   4. The same transaction then runs pinned to that business, attributed to the user in the audit log,
 *      so follow-on effects (activity, events, a job created by accepting a quote) are written consistently.
 */
export async function inBusiness<T>(
  ctx: AppContext,
  subAccountId: string | null | undefined,
  perm: Permission | Permission[],
  fn: (tx: Tx, scope: Scope) => Promise<T>,
  opts: InBusinessOptions = {},
): Promise<T> {
  const id = subAccountId || ctx.current?.id;
  if (!id) throw new ValidationError('Choose a business first.');
  if (!ctx.businesses.some((b) => b.id === id)) throw new ForbiddenError('You do not have access to that business.');
  const perms = Array.isArray(perm) ? perm : [perm];
  return db().transaction(async (tx) => {
    await applyContext(tx, { actor: 'user', userId: ctx.user.id, subAccountIds: [id], ip: ctx.ip });
    for (const p of perms) {
      const res = await tx.execute<{ ok: boolean }>(sql`select app.has_permission(${id}::uuid, ${p}) as ok`);
      if (!res.rows[0]?.ok) {
        throw new ForbiddenError(`Your role in ${ctx.businesses.find((b) => b.id === id)?.name ?? 'this business'} doesn't allow this (${PERMISSION_LABELS[p].toLowerCase()}).`);
      }
    }
    for (const [table, rowId] of opts.visible ?? []) {
      if (!rowId) continue;
      const res = await tx.execute(sql`select 1 from ${sql.identifier(table)} where id = ${rowId}::uuid`);
      if (!res.rows.length) throw new NotFoundError('Record');
    }
    await applyContext(tx, { actor: 'system', subAccountId: id, userId: ctx.user.id, auditActor: 'user', ip: ctx.ip });
    return fn(tx, { subAccountId: id, userId: ctx.user.id, actor: 'user' });
  });
}

export function businessById(ctx: AppContext, id: string | null | undefined) {
  return ctx.businesses.find((b) => b.id === id) ?? null;
}

/** Businesses in scope that have a module switched on and that the user may open. */
export function businessesWithModule(ctx: AppContext, key: ModuleKey) {
  const perm = MODULES.find((m) => m.key === key)?.permission;
  return (ctx.current ? [ctx.current] : ctx.businesses)
    .filter((b) => isModuleEnabled(b.enabledModules, key) && (!perm || grantAllows(ctx.grants[b.id], perm)));
}

export function label(ctx: AppContext, key: 'contact' | 'contacts' | 'deal' | 'deals' | 'job' | 'jobs', fallback: string) {
  return ctx.current?.terminology?.[key] ?? fallback;
}
