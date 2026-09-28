import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { TEST_ENV } from './env';

/** Fresh schema for every test run. */
export default async function setup() {
  const pool = new pg.Pool({ connectionString: TEST_ENV.DATABASE_ADMIN_URL, max: 1 });
  try {
    await pool.query('drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists drizzle cascade; create schema public;');
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
