import 'server-only';
import { randomBytes } from 'node:crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/services/_common';

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/**
 * Turn thrown errors into a friendly result. Unknown errors are logged with a
 * reference the person can quote; technical details never reach the browser.
 *
 * `doing` finishes the sentence "Something went wrong while …", e.g. "creating the invoice".
 * Every action runs in one transaction, so a failure means nothing was saved.
 */
export async function attempt<T>(fn: () => Promise<T>, success?: string, doing?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: success };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
    return { ok: false, error: friendlyError(e, doing) };
  }
}

export function errorRef() {
  return randomBytes(4).toString('hex').toUpperCase();
}

/** Server-side log line with everything needed to debug; the ref is shown to the person. */
export function logError(ref: string, e: unknown, context?: string) {
  const err = e as { message?: string; stack?: string; cause?: { message?: string; code?: string } };
  console.error(JSON.stringify({
    level: 'error', ref, context, message: err?.message, code: err?.cause?.code, cause: err?.cause?.message,
    stack: err?.stack?.split('\n').slice(0, 8).join('\n'), at: new Date().toISOString(),
  }));
}

export function friendlyError(e: unknown, doing?: string): string {
  if (e instanceof ValidationError || e instanceof NotFoundError || e instanceof ForbiddenError) return e.message;
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  if (code === '42501') return "You don't have permission to do that in this business.";
  if (code === '23505') return 'That already exists.';
  if (code === '23503') return 'That record is linked to something in a different business, or is still in use.';
  if (code === '23514') return 'That combination isn’t allowed.';
  const ref = errorRef();
  logError(ref, e, doing);
  return `Something went wrong${doing ? ` while ${doing}` : ''}. Nothing was saved — please try again. (Reference ${ref})`;
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
