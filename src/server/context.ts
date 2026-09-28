import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { withContext } from '@/db/context';
import { accountMembers, accounts, subAccounts, users } from '@/db/schema';
import { isModuleEnabled, type ModuleKey } from '@/lib/modules/registry';
import { getSession } from './auth';
import { ValidationError, type Scope } from './services/_common';

export const BUSINESS_COOKIE = 'bos_business';

export type BusinessLite = typeof subAccounts.$inferSelect;

export type AppContext = {
  user: { id: string; name: string; email: string; timezone: string };
  account: { id: string; name: string; role: 'owner' | 'admin' | 'member' };
  /** Every business this user can open (switcher list). */
  businesses: BusinessLite[];
  /** Selected business, or null for "All Businesses". */
  current: BusinessLite | null;
  /** Business ids this request reads from (1 when a business is selected, all when not). */
  scopeIds: string[];
  isAccountAdmin: boolean;
  tz: string;
};

/** Resolved once per request. Business access comes from the database, not the cookie. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const jar = await cookies();
  const selected = jar.get(BUSINESS_COOKIE)?.value ?? 'all';
  return withContext({ actor: 'user', userId: session.userId, subAccountIds: [] }, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, session.userId));
    if (!user) return null;
    const [membership] = await tx.select({ account: accounts, role: accountMembers.role }).from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .where(eq(accountMembers.userId, user.id)).limit(1);
    if (!membership) return null;
    const businesses = await tx.select().from(subAccounts).where(eq(subAccounts.accountId, membership.account.id))
      .orderBy(asc(subAccounts.sortOrder), asc(subAccounts.name));
    const active = businesses.filter((b) => !b.archivedAt);
    const current = active.find((b) => b.id === selected || b.slug === selected) ?? null;
    return {
      user: { id: user.id, name: user.name, email: user.email, timezone: user.timezone },
      account: { id: membership.account.id, name: membership.account.name, role: membership.role },
      businesses: active,
      current,
      scopeIds: current ? [current.id] : active.map((b) => b.id),
      isAccountAdmin: membership.role === 'owner' || membership.role === 'admin',
      tz: current?.timezone ?? user.timezone,
    } satisfies AppContext;
  });
});

export async function requireContext(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** Read across whatever is selected (one business or all). */
export async function readScope<T>(ctx: AppContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.scopeIds }, fn);
}

/**
 * Work inside ONE business. `subAccountId` may come from a form (e.g. picking a business
 * while in All Businesses view); it must be one of the user's businesses, and RLS checks again.
 */
export async function inBusiness<T>(ctx: AppContext, subAccountId: string | null | undefined, fn: (tx: Tx, scope: Scope) => Promise<T>): Promise<T> {
  const id = subAccountId || ctx.current?.id;
  if (!id) throw new ValidationError('Choose a business first.');
  if (!ctx.businesses.some((b) => b.id === id)) throw new ValidationError('You do not have access to that business.');
  return withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [id] }, (tx) => fn(tx, { subAccountId: id, userId: ctx.user.id, actor: 'user' }));
}

export function businessById(ctx: AppContext, id: string | null | undefined) {
  return ctx.businesses.find((b) => b.id === id) ?? null;
}

/** Businesses in scope that have a module switched on. */
export function businessesWithModule(ctx: AppContext, key: ModuleKey) {
  return (ctx.current ? [ctx.current] : ctx.businesses).filter((b) => isModuleEnabled(b.enabledModules, key));
}

export function label(ctx: AppContext, key: 'contact' | 'contacts' | 'deal' | 'deals' | 'job' | 'jobs', fallback: string) {
  return ctx.current?.terminology?.[key] ?? fallback;
}
