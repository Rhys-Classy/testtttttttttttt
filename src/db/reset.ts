import 'dotenv/config';
import pg from 'pg';

/** DEV ONLY: wipes every schema this app owns. */
export async function resetDatabase(adminUrl = process.env.DATABASE_ADMIN_URL) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query('drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists drizzle cascade; create schema public;');
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase().then(() => console.log('Database reset'));
}
