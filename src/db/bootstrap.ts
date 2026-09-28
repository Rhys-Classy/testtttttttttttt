import pg from 'pg';
import { hashPassword } from '@/lib/auth/password';

/**
 * Creates (or finds) the owner user + master account using the admin connection.
 * This is the only place outside migrations that bypasses row level security:
 * there is no user yet to scope anything to.
 */
export async function bootstrapOwner(adminUrl: string, input: { email: string; name: string; password: string; accountName: string }) {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const email = input.email.trim().toLowerCase();
    let user = (await pool.query<{ id: string }>('select id from users where lower(email) = $1', [email])).rows[0];
    let created = false;
    if (!user) {
      user = (await pool.query<{ id: string }>(
        'insert into users (email, name, password_hash) values ($1, $2, $3) returning id',
        [email, input.name, await hashPassword(input.password)],
      )).rows[0];
      created = true;
    }
    let account = (await pool.query<{ id: string }>(
      `select a.id from accounts a join account_members m on m.account_id = a.id where m.user_id = $1 and m.role = 'owner' limit 1`, [user.id],
    )).rows[0];
    if (!account) {
      account = (await pool.query<{ id: string }>('insert into accounts (name, owner_user_id) values ($1, $2) returning id', [input.accountName, user.id])).rows[0];
      await pool.query(`insert into account_members (account_id, user_id, role) values ($1, $2, 'owner')`, [account.id, user.id]);
    }
    return { userId: user.id, accountId: account.id, createdUser: created };
  } finally {
    await pool.end();
  }
}
