import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { and, eq, ne, sql } from 'drizzle-orm';
import { withAnonymous, withContext } from '@/db/context';
import { sessions, users } from '@/db/schema';
import { decryptJson, encryptJson, randomToken, sha256 } from '@/lib/crypto';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateRecoveryCodes, generateTotpSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from '@/lib/auth/totp';
import { env } from '@/lib/env';
import { rateLimited } from '@/lib/rate-limit';

export const SESSION_COOKIE = 'bos_session';
const MFA_CHALLENGE_COOKIE = 'bos_mfa';
const MFA_ENROL_COOKIE = 'bos_mfa_enrol';
const SESSION_DAYS = 30;
const DEFAULT_IDLE_MINUTES = 7 * 24 * 60;
const MFA_CHALLENGE_MINUTES = 5;
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';

type LoginResult = { ok: true; mfa: boolean } | { ok: false; error: string };

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent')?.slice(0, 200) ?? null,
  };
}

function cookieOpts(expires: Date) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: env().APP_URL.startsWith('https://'), path: '/', expires };
}

async function auditAuth(userId: string, action: string, ip: string | null, data: Record<string, unknown> = {}) {
  await withAnonymous((tx) => tx.execute(sql`select app.audit_auth(${userId}::uuid, ${action}, ${ip}, ${JSON.stringify(data)}::jsonb)`));
}

async function startSession(userId: string) {
  const { ip, userAgent } = await requestMeta();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) =>
    tx.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt, userAgent, ip }));
  (await cookies()).set(SESSION_COOKIE, token, cookieOpts(expiresAt));
  await auditAuth(userId, 'auth.login', ip, { userAgent });
}

/** Step 1: email + password. With two-step verification on, a short-lived challenge replaces the session. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const { ip } = await requestMeta();
  // Brute-force brake: 8 tries per 10 minutes per email+IP.
  if (rateLimited(`login|${email.toLowerCase()}|${ip ?? 'local'}`, 8, 10 * 60_000)) return { ok: false, error: 'Too many attempts. Try again in 10 minutes.' };
  const found = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string; password_hash: string; mfa_enabled: boolean }>(sql`select * from app.auth_find_user(${email})`)).rows[0]);
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, found?.password_hash ?? DUMMY_HASH);
  if (!found || !ok) {
    if (found) await auditAuth(found.id, 'auth.login_failed', ip);
    return { ok: false, error: 'Email or password is incorrect.' };
  }
  if (found.mfa_enabled) {
    const exp = Date.now() + MFA_CHALLENGE_MINUTES * 60_000;
    (await cookies()).set(MFA_CHALLENGE_COOKIE, encryptJson({ p: 'mfa-challenge', uid: found.id, exp }), cookieOpts(new Date(exp)));
    return { ok: true, mfa: true };
  }
  await startSession(found.id);
  return { ok: true, mfa: false };
}

/** Who is half-way through signing in (password done, code pending)? */
export async function pendingMfaUser(): Promise<string | null> {
  const raw = (await cookies()).get(MFA_CHALLENGE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const c = decryptJson<{ p: string; uid: string; exp: number }>(raw);
    return c && c.p === 'mfa-challenge' && c.exp > Date.now() ? c.uid : null;
  } catch {
    return null;
  }
}

type MfaState = { secret_encrypted: string | null; enabled: boolean; last_step: number | null; recovery_codes_left: number };

async function mfaState(userId: string): Promise<MfaState | undefined> {
  return withAnonymous(async (tx) => (await tx.execute<MfaState>(sql`select * from app.auth_mfa_state(${userId}::uuid)`)).rows[0]);
}

/** Check a 6-digit code (once per time step) or a one-time recovery code. */
async function checkSecondFactor(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const state = await mfaState(userId);
  if (!state?.enabled || !state.secret_encrypted) return null;
  const secret = decryptJson<{ secret: string }>(state.secret_encrypted)?.secret;
  const step = secret ? verifyTotp(secret, code) : null;
  if (step !== null) {
    const accepted = await withAnonymous(async (tx) =>
      (await tx.execute<{ ok: boolean }>(sql`select app.auth_consume_totp_step(${userId}::uuid, ${step}) as ok`)).rows[0]?.ok);
    return accepted ? 'totp' : null;
  }
  const rc = normaliseRecoveryCode(code);
  if (/^[a-z0-9]{5}-[a-z0-9]{5}$/.test(rc)) {
    const used = await withAnonymous(async (tx) =>
      (await tx.execute<{ ok: boolean }>(sql`select app.auth_consume_recovery_code(${userId}::uuid, ${sha256(rc)}) as ok`)).rows[0]?.ok);
    return used ? 'recovery' : null;
  }
  return null;
}

/** Step 2: the code from the authenticator app (or a recovery code). */
export async function completeMfaLogin(code: string): Promise<{ ok: true } | { ok: false; error: string; restart?: boolean }> {
  const userId = await pendingMfaUser();
  if (!userId) return { ok: false, error: 'That took too long. Please log in again.', restart: true };
  const { ip } = await requestMeta();
  if (rateLimited(`mfa|${userId}`, 6, 10 * 60_000)) return { ok: false, error: 'Too many attempts. Try again in 10 minutes.' };
  const how = await checkSecondFactor(userId, code);
  if (!how) {
    await auditAuth(userId, 'auth.mfa_failed', ip);
    return { ok: false, error: 'That code didn’t work. Check the time on your phone and try the newest code.' };
  }
  (await cookies()).delete(MFA_CHALLENGE_COOKIE);
  await startSession(userId);
  if (how === 'recovery') await auditAuth(userId, 'auth.recovery_code_used', ip);
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const { ip } = await requestMeta();
    const userId = await withAnonymous(async (tx) =>
      (await tx.execute<{ end_session: string | null }>(sql`select app.end_session(${sha256(token)})`)).rows[0]?.end_session);
    if (userId) await auditAuth(userId, 'auth.logout', ip);
  }
  jar.delete(SESSION_COOKIE);
}

export type Session = { userId: string; sessionId: string; needsMfaSetup: boolean };

/** Session from the cookie, once per request. Enforces expiry and the account's idle timeout. */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await withAnonymous(async (tx) =>
    (await tx.execute<{ session_id: string; user_id: string; last_seen_at: Date; idle_minutes: number | null; require_mfa: boolean; mfa_enabled: boolean }>(
      sql`select * from app.auth_session(${sha256(token)})`)).rows[0]);
  if (!row) return null;
  const idleMs = (row.idle_minutes || DEFAULT_IDLE_MINUTES) * 60_000;
  if (Date.now() - new Date(row.last_seen_at).getTime() > idleMs) {
    await withAnonymous((tx) => tx.execute(sql`select app.end_session(${sha256(token)})`));
    return null;
  }
  await withAnonymous((tx) => tx.execute(sql`select app.touch_session(${row.session_id}::uuid)`));
  return { userId: row.user_id, sessionId: row.session_id, needsMfaSetup: row.require_mfa && !row.mfa_enabled };
});

/* ------------------------------------------------------------------ */
/* Signed-in security settings                                         */
/* ------------------------------------------------------------------ */

export async function changePassword(userId: string, current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (next.length < 10) return { ok: false, error: 'Use at least 10 characters.' };
  const { ip } = await requestMeta();
  const session = await getSession();
  const hash = await withContext({ actor: 'user', userId, subAccountIds: [] }, async (tx) =>
    (await tx.execute<{ h: string }>(sql`select app.my_password_hash() as h`)).rows[0]?.h);
  if (!hash || !(await verifyPassword(current, hash))) return { ok: false, error: 'Current password is incorrect.' };
  await withContext({ actor: 'user', userId, subAccountIds: [] }, async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    // Everyone else signed in as you is signed out.
    if (session) await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, session.sessionId)));
  });
  await auditAuth(userId, 'auth.password_changed', ip);
  return { ok: true };
}

export async function revokeSession(userId: string, sessionId: string | 'others') {
  const { ip } = await requestMeta();
  const current = await getSession();
  await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) =>
    sessionId === 'others'
      ? tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, current?.sessionId ?? '00000000-0000-0000-0000-000000000000')))
      : tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId))));
  await auditAuth(userId, 'auth.session_revoked', ip, { which: sessionId === 'others' ? 'all other devices' : 'one device' });
}

/** Begin setting up an authenticator app: the secret lives in an encrypted cookie until confirmed. */
export async function beginMfaEnrolment(userId: string, email: string) {
  const secret = generateTotpSecret();
  const exp = Date.now() + 15 * 60_000;
  (await cookies()).set(MFA_ENROL_COOKIE, encryptJson({ p: 'mfa-enrol', uid: userId, secret, exp }), cookieOpts(new Date(exp)));
  return { secret, uri: otpauthUri(secret, email) };
}

export async function pendingEnrolment(userId: string): Promise<{ secret: string } | null> {
  const raw = (await cookies()).get(MFA_ENROL_COOKIE)?.value;
  if (!raw) return null;
  try {
    const c = decryptJson<{ p: string; uid: string; secret: string; exp: number }>(raw);
    return c && c.p === 'mfa-enrol' && c.uid === userId && c.exp > Date.now() ? { secret: c.secret } : null;
  } catch {
    return null;
  }
}

/** Confirm with a code from the app; returns the recovery codes (shown once). */
export async function confirmMfaEnrolment(userId: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const pending = await pendingEnrolment(userId);
  if (!pending) return { ok: false, error: 'Setup timed out. Start again.' };
  const step = verifyTotp(pending.secret, code);
  if (step === null) return { ok: false, error: 'That code didn’t match. Try the newest code in the app.' };
  const recoveryCodes = generateRecoveryCodes();
  const { ip } = await requestMeta();
  await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) =>
    tx.update(users).set({
      mfaSecretEncrypted: encryptJson({ secret: pending.secret }), mfaEnabledAt: new Date(), mfaLastStep: step,
      mfaRecoveryHashes: recoveryCodes.map((c) => sha256(c)), updatedAt: new Date(),
    }).where(eq(users.id, userId)));
  // The setup cookie is cleared by finishMfaEnrolment(): changing cookies here would
  // re-render the page and hide the recovery codes before they're saved.
  await auditAuth(userId, 'auth.mfa_enabled', ip);
  return { ok: true, recoveryCodes };
}

export async function finishMfaEnrolment() {
  (await cookies()).delete(MFA_ENROL_COOKIE);
}

export async function disableMfa(userId: string, password: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const hash = await withContext({ actor: 'user', userId, subAccountIds: [] }, async (tx) =>
    (await tx.execute<{ h: string }>(sql`select app.my_password_hash() as h`)).rows[0]?.h);
  if (!hash || !(await verifyPassword(password, hash))) return { ok: false, error: 'Password is incorrect.' };
  if (!(await checkSecondFactor(userId, code))) return { ok: false, error: 'That code didn’t work.' };
  const { ip } = await requestMeta();
  await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) =>
    tx.update(users).set({ mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [], updatedAt: new Date() }).where(eq(users.id, userId)));
  await auditAuth(userId, 'auth.mfa_disabled', ip);
  return { ok: true };
}

export async function regenerateRecoveryCodes(userId: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  if ((await checkSecondFactor(userId, code)) !== 'totp') return { ok: false, error: 'Enter a current code from your authenticator app.' };
  const recoveryCodes = generateRecoveryCodes();
  await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) =>
    tx.update(users).set({ mfaRecoveryHashes: recoveryCodes.map((c) => sha256(c)), updatedAt: new Date() }).where(eq(users.id, userId)));
  await auditAuth(userId, 'auth.recovery_codes_regenerated', (await requestMeta()).ip);
  return { ok: true, recoveryCodes };
}

export async function recoveryCodesLeft(userId: string) {
  return (await mfaState(userId))?.recovery_codes_left ?? 0;
}
