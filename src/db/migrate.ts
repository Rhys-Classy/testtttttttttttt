import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Runs migrations as the admin/owner role. Optionally sets the runtime role's password. */
export async function runMigrations(adminUrl = process.env.DATABASE_ADMIN_URL) {
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to run migrations');
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const appPassword = process.env.APP_DB_PASSWORD;
    if (appPassword) {
      const client = await pool.connect();
      try {
        const quoted = await client.query('select quote_literal($1) as q', [appPassword]);
        await client.query(`alter role bos_app login password ${quoted.rows[0].q}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log('Migrations complete'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
