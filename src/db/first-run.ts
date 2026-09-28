import pg from 'pg';
import { onManagedDatabase, ownerDatabaseUrl } from './connection';

type Globals = { __bosFirstRun?: Promise<void> };
const g = globalThis as unknown as Globals;

/**
 * Hosted installs (Netlify) have no shell to run `npm run db:seed`. The first
 * login attempt creates the owner (SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD) and the
 * starting businesses — but only while the database has no accounts at all, so
 * it can never add a second owner to a running system.
 */
export function ensureFirstOwner(): Promise<void> {
  if (!onManagedDatabase() || !process.env.SEED_OWNER_EMAIL || !process.env.SEED_OWNER_PASSWORD) return Promise.resolve();
  g.__bosFirstRun ??= (async () => {
    const owner = new pg.Client({ connectionString: ownerDatabaseUrl() });
    await owner.connect();
    let empty: boolean;
    try {
      empty = (await owner.query<{ empty: boolean }>('select not exists (select 1 from accounts) as empty')).rows[0].empty;
    } finally {
      await owner.end();
    }
    if (!empty) return;
    const { seed } = await import('./seed');
    await seed({ adminUrl: ownerDatabaseUrl() });
  })().catch((e) => {
    g.__bosFirstRun = undefined;
    throw e;
  });
  return g.__bosFirstRun;
}
