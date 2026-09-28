import 'server-only';
import { isModuleEnabled, type ModuleKey } from '@/lib/modules/registry';
import type { AppContext } from './context';

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function sp1(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Which businesses a list page reads from: the selected business, or in All view
 * every business with the module switched on, optionally narrowed with ?b=<id>.
 */
export function moduleScope(ctx: AppContext, key: ModuleKey, bParam?: string) {
  const pool = (ctx.current ? [ctx.current] : ctx.businesses).filter((b) => isModuleEnabled(b.enabledModules, key));
  const narrowed = bParam ? pool.filter((b) => b.id === bParam) : pool;
  return { businesses: pool, ids: narrowed.map((b) => b.id), filtered: !!bParam && narrowed.length > 0 };
}

export function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const merged = { ...base, ...patch };
  const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return s ? `?${s}` : '';
}
