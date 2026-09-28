import 'server-only';
import { NotFoundError, ValidationError } from '@/server/services/_common';

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Turn thrown errors into a friendly result. Unknown errors are logged, not leaked. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: success };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
    return { ok: false, error: friendlyError(e) };
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof ValidationError || e instanceof NotFoundError) return e.message;
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  if (code === '42501') return "You don't have permission to do that in this business.";
  if (code === '23505') return 'That already exists.';
  if (code === '23503') return 'That record is linked to something in a different business, or is still in use.';
  console.error(e);
  return 'Something went wrong. Please try again.';
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export function optStr(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

export function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
