import 'server-only';
import { isModuleEnabled, MODULES, type ModuleKey } from '@/lib/modules/registry';
import { grantAllows, type Permission } from '@/lib/permissions';
import type { AppContext } from './context';

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function sp1(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Which businesses a page reads from: the selected business, or in All view
 * every business with the module switched on AND where the user's role allows
 * `perm` (defaults to the module's view permission), optionally narrowed with ?b=<id>.
 * `noAccess` = the module is on somewhere, but the role doesn't include it.
 */
export function moduleScope(ctx: AppContext, key: ModuleKey, bParam?: string, perm?: Permission) {
  const need = perm ?? MODULES.find((m) => m.key === key)!.permission;
  const enabled = (ctx.current ? [ctx.current] : ctx.businesses).filter((b) => isModuleEnabled(b.enabledModules, key));
  const pool = enabled.filter((b) => grantAllows(ctx.grants[b.id], need));
  const narrowed = bParam ? pool.filter((b) => b.id === bParam) : pool;
  return { businesses: pool, ids: narrowed.map((b) => b.id), filtered: !!bParam && narrowed.length > 0, noAccess: enabled.length > 0 && pool.length === 0 };
}

export function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const merged = { ...base, ...patch };
  const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return s ? `?${s}` : '';
}

/** Lists show 50 rows a page: the browser never receives the whole CRM. */
export const PAGE_SIZE = 50;

export function pageOf(p: Record<string, string | string[] | undefined>) {
  const page = Math.max(1, Math.min(1000, Math.floor(Number(sp1(p.page))) || 1));
  return { page, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 };
}

/** Fetch PAGE_SIZE + 1 rows, then split: the extra row only tells us there's a next page. */
export function splitPage<T>(rows: T[]) {
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}
