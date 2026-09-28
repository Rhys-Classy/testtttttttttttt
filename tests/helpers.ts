import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { withContext, type DbContext } from '@/db/context';
import type { Tx } from '@/db/client';
import { hashPassword } from '@/lib/auth/password';
import type { Scope } from '@/server/services/_common';
import { createBusiness, installBusinessDefaults } from '@/server/services/businesses';
import { TEST_ENV } from './env';

export function admin() {
  return new pg.Pool({ connectionString: TEST_ENV.DATABASE_ADMIN_URL, max: 2 });
}

export type Fixture = {
  ownerId: string;
  staffId: string;
  viewerId: string;
  outsiderId: string;
  accountId: string;
  otherAccountId: string;
  bizA: string;
  bizB: string;
  otherBiz: string;
};

async function insertUser(pool: pg.Pool, label: string) {
  const email = `${label}-${randomUUID()}@test.local`;
  const { rows } = await pool.query<{ id: string }>('insert into users (email, name, password_hash) values ($1, $2, $3) returning id', [email, label, await hashPassword('pw-123456')]);
  return rows[0].id;
}

/**
 * Two businesses under one master account + a separate account:
 *  owner    - account owner (sees A and B)
 *  staff    - staff member of A only
 *  viewer   - viewer of B only (read-only)
 *  outsider - owner of a completely different account
 */
export async function createFixture(): Promise<Fixture> {
  const pool = admin();
  try {
    const ownerId = await insertUser(pool, 'owner');
    const staffId = await insertUser(pool, 'staff');
    const viewerId = await insertUser(pool, 'viewer');
    const outsiderId = await insertUser(pool, 'outsider');
    const acc = async (owner: string) => {
      const { rows } = await pool.query<{ id: string }>('insert into accounts (name, owner_user_id) values ($1, $2) returning id', ['Test account', owner]);
      await pool.query(`insert into account_members (account_id, user_id, role) values ($1, $2, 'owner')`, [rows[0].id, owner]);
      return rows[0].id;
    };
    const accountId = await acc(ownerId);
    const otherAccountId = await acc(outsiderId);
    await pool.query(`insert into account_members (account_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member')`, [accountId, staffId, viewerId]);

    const bizA = await makeBusiness(ownerId, accountId, 'Alpha Kitchens');
    const bizB = await makeBusiness(ownerId, accountId, 'Bravo Clothing');
    const otherBiz = await makeBusiness(outsiderId, otherAccountId, 'Outsider Co');
    await pool.query(`insert into sub_account_members (sub_account_id, user_id, role) values ($1, $2, 'staff'), ($3, $4, 'viewer')`, [bizA, staffId, bizB, viewerId]);
    return { ownerId, staffId, viewerId, outsiderId, accountId, otherAccountId, bizA, bizB, otherBiz };
  } finally {
    await pool.end();
  }
}

async function makeBusiness(userId: string, accountId: string, name: string) {
  const row = await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) => createBusiness(tx, accountId, { name, preset: 'everything' }));
  await withContext({ actor: 'user', userId, subAccountIds: [row.id] }, (tx) => installBusinessDefaults(tx, { subAccountId: row.id, userId, actor: 'user' }, 'trades'));
  return row.id;
}

/** Run as a user inside one business. */
export function asUser<T>(userId: string, subAccountId: string | string[], fn: (tx: Tx, scope: Scope) => Promise<T>) {
  const ids = Array.isArray(subAccountId) ? subAccountId : [subAccountId];
  return withContext({ actor: 'user', userId, subAccountIds: ids }, (tx) => fn(tx, { subAccountId: ids[0], userId, actor: 'user' }));
}

export function asSystem<T>(subAccountId: string, fn: (tx: Tx, scope: Scope) => Promise<T>) {
  return withContext({ actor: 'system', subAccountId }, (tx) => fn(tx, { subAccountId, userId: null, actor: 'system' }));
}

export function raw<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>) {
  return withContext(ctx, fn);
}

/** Expect a promise to reject with a Postgres error code (42501 = RLS / permission, 23503 = FK). */
export async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}
