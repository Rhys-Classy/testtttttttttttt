import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { withAnonymous, withContext } from '@/db/context';
import { sessions } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { verifyPassword } from '@/lib/auth/password';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'bos_session';
const SESSION_DAYS = 30;

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Simple in-memory brute-force brake: 8 tries per 10 minutes per email+IP. */
function rateLimited(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  a.count++;
  return a.count > 8;
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(`${email.toLowerCase()}|${ip}`)) return { ok: false, error: 'Too many attempts. Try again in 10 minutes.' };
  const found = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string; password_hash: string }>(sql`select * from app.auth_find_user(${email})`)).rows[0]);
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, found?.password_hash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!found || !ok) return { ok: false, error: 'Email or password is incorrect.' };
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await withContext({ actor: 'user', userId: found.id, subAccountIds: [] }, (tx) =>
    tx.insert(sessions).values({ userId: found.id, tokenHash: sha256(token), expiresAt, userAgent: h.get('user-agent')?.slice(0, 200) }));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: env().APP_URL.startsWith('https://'), path: '/', expires: expiresAt,
  });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await getSession();
    if (session) {
      await withContext({ actor: 'user', userId: session.userId, subAccountIds: [] }, (tx) =>
        tx.delete(sessions).where(eq(sessions.tokenHash, sha256(token))));
    }
  }
  jar.delete(SESSION_COOKIE);
}

/** Session from the cookie, once per request. */
export const getSession = cache(async (): Promise<{ userId: string; sessionId: string } | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await withAnonymous(async (tx) =>
    (await tx.execute<{ session_id: string; user_id: string }>(sql`select * from app.auth_session(${sha256(token)})`)).rows[0]);
  return row ? { userId: row.user_id, sessionId: row.session_id } : null;
});
