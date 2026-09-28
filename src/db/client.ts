import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { appDatabaseUrl, onManagedDatabase } from './connection';
import * as schema from './schema';

// int8 + numeric aggregates come back as strings by default. Our values (cents, counts)
// stay well inside Number.MAX_SAFE_INTEGER, so parse them as numbers.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

type Globals = { __bosPool?: pg.Pool };
const g = globalThis as unknown as Globals;

/** Pool for the runtime role (`bos_app`). Every query through it is subject to row level security. */
export function appPool(): pg.Pool {
  if (!g.__bosPool) {
    // Serverless instances are many and short-lived: keep each one's pool small.
    const max = Number(process.env.DB_POOL_MAX ?? (onManagedDatabase() ? 3 : 10));
    g.__bosPool = new pg.Pool({ connectionString: appDatabaseUrl(), max, idleTimeoutMillis: 10_000 });
  }
  return g.__bosPool;
}

export function makeDb(pool: pg.Pool) {
  return drizzle(pool, { schema, casing: undefined });
}

export type Db = ReturnType<typeof makeDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let dbInstance: Db | undefined;
export function db(): Db {
  if (!dbInstance) dbInstance = makeDb(appPool());
  return dbInstance;
}

export async function closeDb() {
  await g.__bosPool?.end();
  g.__bosPool = undefined;
  dbInstance = undefined;
}
