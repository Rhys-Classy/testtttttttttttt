import pg from 'pg';
import { getConnectionString } from '@netlify/database';

/**
 * Where the database is.
 *
 *  - Self-host / Docker / tests: DATABASE_URL (runtime role `bos_app`) and
 *    DATABASE_ADMIN_URL (owner, migrations + first-run setup only).
 *  - Netlify: the platform provides the owner connection (Netlify Database).
 *    The app never queries business data with it: it derives a `bos_app` login
 *    on the same database (password APP_DB_PASSWORD), so row level security
 *    applies exactly as on a self-hosted server.
 */
function netlifyOwnerUrl(): string | undefined {
  try {
    return getConnectionString();
  } catch {
    return undefined;
  }
}

export const onManagedDatabase = () => !process.env.DATABASE_URL && !!netlifyOwnerUrl();

/** Owner connection: migrations, first-run setup, enabling the runtime login. Never for app queries. */
export function ownerDatabaseUrl(): string | undefined {
  return process.env.DATABASE_ADMIN_URL || netlifyOwnerUrl();
}

/** Runtime connection (`bos_app`, subject to row level security). */
export function appDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const owner = netlifyOwnerUrl();
  const password = process.env.APP_DB_PASSWORD;
  if (!owner) throw new Error('No database configured: set DATABASE_URL, or deploy on Netlify with Netlify Database.');
  if (!password || password.length < 24) throw new Error('Set APP_DB_PASSWORD (24+ random characters) for the runtime database login.');
  const u = new URL(owner);
  u.username = 'bos_app';
  u.password = password;
  return u.toString();
}

type Globals = { __bosRoleReady?: Promise<void> };
const g = globalThis as unknown as Globals;

const isAuthError = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  return (err.code ?? '').startsWith('28') || /password authentication failed|not permitted to log in|role .* does not exist/i.test(err.message ?? '');
};

/**
 * On Netlify the migrations create `bos_app` without a password (secrets don't
 * belong in migration files). The first request after a deploy notices it can't
 * log in, and switches the login on with APP_DB_PASSWORD using the owner
 * connection. Every later request skips this.
 */
export function ensureRuntimeLogin(): Promise<void> {
  if (!onManagedDatabase()) return Promise.resolve();
  g.__bosRoleReady ??= (async () => {
    const probe = new pg.Client({ connectionString: appDatabaseUrl() });
    try {
      await probe.connect();
      await probe.end();
      return;
    } catch (e) {
      await probe.end().catch(() => undefined);
      if (!isAuthError(e)) throw e;
    }
    const owner = new pg.Client({ connectionString: ownerDatabaseUrl() });
    await owner.connect();
    try {
      const quoted = await owner.query<{ q: string }>('select quote_literal($1) as q', [process.env.APP_DB_PASSWORD]);
      await owner.query(`alter role bos_app with login password ${quoted.rows[0].q}`);
    } finally {
      await owner.end();
    }
  })().catch((e) => {
    g.__bosRoleReady = undefined;
    throw e;
  });
  return g.__bosRoleReady;
}
