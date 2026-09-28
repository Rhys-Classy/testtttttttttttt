import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { withAnonymous } from '@/db/context';
import { sha256 } from '@/lib/crypto';
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, normaliseRecoveryCode, otpauthUri, totp, totpStep, verifyTotp } from '@/lib/auth/totp';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { admin, createFixture, type Fixture } from './helpers';

let f: Fixture;
beforeAll(async () => { f = await createFixture(); });
afterAll(async () => { await closeDb(); });

// RFC 6238 appendix B (SHA-1), truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (authenticator app codes)', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const k = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(k, c))).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('accepts one step of clock drift, nothing more, and returns the step', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32, builds an otpauth URI and readable recovery codes', () => {
    const b = Buffer.from('hello world, secret');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    expect(otpauthUri(RFC_SECRET, 'me@example.com')).toMatch(/^otpauth:\/\/totp\/Business%20OS%3Ame%40example\.com\?secret=GEZ/);
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(normaliseRecoveryCode(' ABCDE 12345 ')).toBe('abcde-12345');
  });
});

describe('sign-in state in the database', () => {
  it('passwords are salted scrypt hashes', async () => {
    const h1 = await hashPassword('correct horse battery');
    const h2 = await hashPassword('correct horse battery');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('correct horse battery', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
  });

  it('a TOTP time step is accepted once (no replay)', async () => {
    const pool = admin();
    await pool.query(`update users set mfa_enabled_at = now(), mfa_last_step = null where id = $1`, [f.ownerId]);
    await pool.end();
    const consume = (step: number) => withAnonymous(async (tx) =>
      (await tx.execute<{ ok: boolean }>(sql`select app.auth_consume_totp_step(${f.ownerId}::uuid, ${step}) as ok`)).rows[0].ok);
    expect(await consume(1000)).toBe(true);
    expect(await consume(1000)).toBe(false);
    expect(await consume(999)).toBe(false);
    expect(await consume(1001)).toBe(true);
  });

  it('recovery codes work exactly once', async () => {
    const codes = generateRecoveryCodes(2);
    const pool = admin();
    await pool.query(`update users set mfa_recovery_hashes = $2 where id = $1`, [f.ownerId, codes.map(sha256)]);
    await pool.end();
    const use = (c: string) => withAnonymous(async (tx) =>
      (await tx.execute<{ ok: boolean }>(sql`select app.auth_consume_recovery_code(${f.ownerId}::uuid, ${sha256(c)}) as ok`)).rows[0].ok);
    expect(await use(codes[0])).toBe(true);
    expect(await use(codes[0])).toBe(false);
    const left = await withAnonymous(async (tx) => (await tx.execute<{ recovery_codes_left: number }>(sql`select * from app.auth_mfa_state(${f.ownerId}::uuid)`)).rows[0]);
    expect(left.recovery_codes_left).toBe(1);
  });

  it('sessions report idle limits and the require-two-step rule; ending one removes it', async () => {
    const pool = admin();
    const token = 'test-session-token';
    await pool.query(`update accounts set settings = settings || '{"requireMfa": true, "sessionIdleMinutes": 60}' where id = $1`, [f.accountId]);
    await pool.query(`update users set mfa_enabled_at = null where id = $1`, [f.staffId]);
    await pool.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [f.staffId, sha256(token)]);
    await pool.end();
    const s = await withAnonymous(async (tx) => (await tx.execute<{ user_id: string; idle_minutes: number; require_mfa: boolean; mfa_enabled: boolean }>(sql`select * from app.auth_session(${sha256(token)})`)).rows[0]);
    expect(s).toMatchObject({ user_id: f.staffId, idle_minutes: 60, require_mfa: true, mfa_enabled: false });
    await withAnonymous((tx) => tx.execute(sql`select app.end_session(${sha256(token)})`));
    const gone = await withAnonymous(async (tx) => (await tx.execute(sql`select * from app.auth_session(${sha256(token)})`)).rows);
    expect(gone).toHaveLength(0);
  });

  it('sign-in events land in the audit log for the account', async () => {
    await withAnonymous((tx) => tx.execute(sql`select app.audit_auth(${f.staffId}::uuid, 'auth.login', '203.0.113.9', '{}'::jsonb)`));
    const pool = admin();
    try {
      const { rows } = await pool.query(`select action, account_id, ip from audit_log where actor_user_id = $1 and action = 'auth.login'`, [f.staffId]);
      expect(rows[0]).toMatchObject({ action: 'auth.login', account_id: f.accountId, ip: '203.0.113.9' });
      const { rows: u } = await pool.query(`select last_login_at from users where id = $1`, [f.staffId]);
      expect(u[0].last_login_at).toBeTruthy();
    } finally {
      await pool.end();
    }
    // Only auth.* events can be written through this door.
    await expect(withAnonymous((tx) => tx.execute(sql`select app.audit_auth(${f.staffId}::uuid, 'invoice.paid', null, '{}'::jsonb)`))).rejects.toThrow();
  });
});
