import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { contacts, integrations, invoices, subAccounts, tasks } from '@/db/schema';
import { createContact } from '@/server/services/crm';
import { createInvoice } from '@/server/services/finance';
import { connectBusinessIntegration, connectGlobalIntegration, getBusinessCredentials, listBusinessIntegrations } from '@/server/services/integrations';
import { getBusinessSummaries, getMoney } from '@/server/queries/dashboard';
import { globalSearch } from '@/server/queries/search';
import { admin, asSystem, asUser, createFixture, pgErrorCode, raw, type Fixture } from './helpers';

let f: Fixture;
let contactA: string;
let contactB: string;

beforeAll(async () => {
  f = await createFixture();
  contactA = (await asUser(f.ownerId, f.bizA, (tx, s) => createContact(tx, s, { name: 'John Smith', email: 'john@a.test' }))).id;
  contactB = (await asUser(f.ownerId, f.bizB, (tx, s) => createContact(tx, s, { name: 'John Smith', email: 'john@b.test' }))).id;
  await asUser(f.ownerId, f.bizA, (tx, s) => createInvoice(tx, s, { contactId: contactA, lines: [{ description: 'Doors', quantity: 1, unitPriceCents: 100_000 }] }));
});

afterAll(async () => {
  await closeDb();
});

describe('row level security between businesses', () => {
  it('a request in business A only sees business A rows', async () => {
    const rows = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(contacts));
    expect(rows.map((r) => r.subAccountId)).toEqual([f.bizA]);
  });

  it('All Businesses context sees both, each row tagged with its business', async () => {
    const rows = await asUser(f.ownerId, [f.bizA, f.bizB], (tx) => tx.select().from(contacts));
    expect(new Set(rows.map((r) => r.subAccountId))).toEqual(new Set([f.bizA, f.bizB]));
  });

  it('even an explicit WHERE on the other business returns nothing', async () => {
    const rows = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(contacts).where(eq(contacts.subAccountId, f.bizB)));
    expect(rows).toHaveLength(0);
    const byId = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(contacts).where(eq(contacts.id, contactB)));
    expect(byId).toHaveLength(0);
  });

  it('cannot update or delete another business’s rows from business A', async () => {
    const updated = await asUser(f.ownerId, f.bizA, (tx) => tx.update(contacts).set({ firstName: 'Hacked' }).where(eq(contacts.id, contactB)).returning());
    expect(updated).toHaveLength(0);
    const deleted = await asUser(f.ownerId, f.bizA, (tx) => tx.delete(contacts).where(eq(contacts.id, contactB)).returning());
    expect(deleted).toHaveLength(0);
    const still = await asUser(f.ownerId, f.bizB, (tx) => tx.select().from(contacts).where(eq(contacts.id, contactB)));
    expect(still[0].firstName).toBe('John');
  });

  it('cannot insert a row into business B while working in business A', async () => {
    const code = await pgErrorCode(asUser(f.ownerId, f.bizA, (tx) =>
      tx.insert(contacts).values({ subAccountId: f.bizB, firstName: 'Sneaky' })));
    expect(code).toBe('42501');
  });

  it('a forged business id in the context is ignored: membership is checked in the database', async () => {
    // Staff member of A asks for B.
    const rows = await asUser(f.staffId, f.bizB, (tx) => tx.select().from(contacts));
    expect(rows).toHaveLength(0);
    const code = await pgErrorCode(asUser(f.staffId, f.bizB, (tx, s) => createContact(tx, s, { name: 'Nope' })));
    expect(code).toBe('42501');
    // Outsider from another master account asks for A.
    expect(await asUser(f.outsiderId, f.bizA, (tx) => tx.select().from(contacts))).toHaveLength(0);
    expect(await asUser(f.outsiderId, f.bizA, (tx) => tx.select().from(subAccounts).where(eq(subAccounts.id, f.bizA)))).toHaveLength(0);
  });

  it('staff only see the businesses they belong to in the switcher', async () => {
    const rows = await raw({ actor: 'user', userId: f.staffId, subAccountIds: [] }, (tx) => tx.select().from(subAccounts));
    expect(rows.map((r) => r.id)).toEqual([f.bizA]);
  });

  it('viewers can read but not write', async () => {
    const rows = await asUser(f.viewerId, f.bizB, (tx) => tx.select().from(contacts));
    expect(rows.length).toBeGreaterThan(0);
    expect(await pgErrorCode(asUser(f.viewerId, f.bizB, (tx, s) => createContact(tx, s, { name: 'Viewer write' })))).toBe('42501');
    const upd = await asUser(f.viewerId, f.bizB, (tx) => tx.update(contacts).set({ firstName: 'X' }).where(eq(contacts.id, contactB)).returning());
    expect(upd).toHaveLength(0);
  });

  it('no context at all sees nothing', async () => {
    const rows = await raw({ actor: 'user', userId: null, subAccountIds: [] }, (tx) => tx.select().from(contacts));
    expect(rows).toHaveLength(0);
  });

  it('system context is pinned to exactly one business', async () => {
    const one = await asSystem(f.bizA, (tx) => tx.select().from(contacts));
    expect(one.every((r) => r.subAccountId === f.bizA)).toBe(true);
    // Try to widen a system context by setting two ids manually.
    const widened = await raw({ actor: 'system', subAccountId: f.bizA }, async (tx) => {
      await tx.execute(sql`select set_config('app.sub_account_ids', ${`${f.bizA},${f.bizB}`}, true)`);
      return tx.select().from(contacts);
    });
    expect(widened).toHaveLength(0);
  });

  it('composite foreign keys stop cross-business references even when RLS is bypassed', async () => {
    const pool = admin();
    try {
      const err = await pool.query(
        `insert into invoices (sub_account_id, number, contact_id, issue_date, due_date, public_token) values ($1, 'X-1', $2, current_date, current_date, 'tok-' || gen_random_uuid())`,
        [f.bizA, contactB],
      ).then(() => null, (e: { code: string }) => e.code);
      expect(err).toBe('23503');
    } finally {
      await pool.end();
    }
  });

  it('services cannot link records across businesses', async () => {
    const code = await pgErrorCode(asUser(f.ownerId, [f.bizA, f.bizB], (tx) =>
      tx.insert(tasks).values({ subAccountId: f.bizA, title: 'Cross link', contactId: contactB })));
    expect(code).toBe('23503');
  });

  it('every business-owned table has RLS and the tenant policy', async () => {
    const pool = admin();
    try {
      const { rows } = await pool.query<{ table_name: string; rls: boolean; policies: number }>(`
        select c.table_name, cls.relrowsecurity as rls,
          (select count(*) from pg_policies p where p.tablename = c.table_name and p.policyname = 'tenant_isolation')::int as policies
        from information_schema.columns c
        join pg_class cls on cls.relname = c.table_name and cls.relkind = 'r'
        where c.table_schema = 'public' and c.column_name = 'sub_account_id' and c.table_name not in ('integrations', 'sub_account_members')`);
      expect(rows.length).toBeGreaterThan(30);
      const missing = rows.filter((r) => !r.rls || r.policies !== 1).map((r) => r.table_name);
      expect(missing).toEqual([]);
      const { rows: all } = await pool.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
      expect(all).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it('the runtime role cannot bypass RLS', async () => {
    const res = await raw({ actor: 'user', userId: null, subAccountIds: [] }, (tx) =>
      tx.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`));
    expect(res.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('integrations belong to a business', () => {
  it('each business has its own Stripe credentials, invisible to the other', async () => {
    await asUser(f.ownerId, f.bizA, (tx, s) => connectBusinessIntegration(tx, s, 'stripe', { secretKey: 'sk_test_AAAA1111', webhookSecret: 'whsec_a' }));
    await asUser(f.ownerId, f.bizB, (tx, s) => connectBusinessIntegration(tx, s, 'stripe', { secretKey: 'sk_test_BBBB2222', webhookSecret: 'whsec_b' }));
    const a = await asUser(f.ownerId, f.bizA, (tx, s) => getBusinessCredentials(tx, s, ['stripe']));
    const b = await asUser(f.ownerId, f.bizB, (tx, s) => getBusinessCredentials(tx, s, ['stripe']));
    expect(a?.secrets.secretKey).toBe('sk_test_AAAA1111');
    expect(b?.secrets.secretKey).toBe('sk_test_BBBB2222');
    const visibleFromA = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(integrations));
    expect(visibleFromA.every((i) => i.subAccountId === f.bizA || i.scope === 'global')).toBe(true);
    // Staff of A can't read B's integration
    expect(await asUser(f.staffId, f.bizB, (tx) => tx.select().from(integrations).where(eq(integrations.subAccountId, f.bizB)))).toHaveLength(0);
  });

  it('secrets are encrypted at rest and masked in listings', async () => {
    const pool = admin();
    try {
      const { rows } = await pool.query<{ secrets_encrypted: string }>(`select secrets_encrypted from integrations where sub_account_id = $1 and provider = 'stripe'`, [f.bizA]);
      expect(rows[0].secrets_encrypted).not.toContain('sk_test_AAAA1111');
      expect(rows[0].secrets_encrypted.startsWith('v1.')).toBe(true);
    } finally {
      await pool.end();
    }
    const listed = await asUser(f.ownerId, f.bizA, (tx, s) => listBusinessIntegrations(tx, s));
    const stripe = listed.find((i) => i.provider === 'stripe')!;
    expect(JSON.stringify(stripe)).not.toContain('sk_test_AAAA1111');
    expect(stripe.secretHints.secretKey).toBe('••••1111');
  });

  it('global integrations are owned by the master account and need an account admin', async () => {
    await raw({ actor: 'user', userId: f.ownerId, subAccountIds: [] }, (tx) => connectGlobalIntegration(tx, f.accountId, 'anthropic', { apiKey: 'sk-ant-xyz' }));
    const code = await pgErrorCode(raw({ actor: 'user', userId: f.staffId, subAccountIds: [f.bizA] }, (tx) => connectGlobalIntegration(tx, f.accountId, 'openai-ish-not-real', {})));
    expect(code === '42501' || code === undefined).toBe(true); // unknown provider throws ValidationError before the DB
    const staffWrite = await pgErrorCode(raw({ actor: 'user', userId: f.staffId, subAccountIds: [f.bizA] }, (tx) =>
      tx.insert(integrations).values({ accountId: f.accountId, scope: 'global', provider: 'anthropic', status: 'connected' })));
    expect(staffWrite).toBe('42501');
    const outsiderSees = await raw({ actor: 'user', userId: f.outsiderId, subAccountIds: [] }, (tx) => tx.select().from(integrations).where(eq(integrations.scope, 'global')));
    expect(outsiderSees.filter((i) => i.accountId === f.accountId)).toHaveLength(0);
  });

  it('the database enforces integration ownership shape', async () => {
    const pool = admin();
    try {
      const bad = await pool.query(`insert into integrations (account_id, scope, sub_account_id, provider) values ($1, 'global', $2, 'x')`, [f.accountId, f.bizA])
        .then(() => null, (e: { code: string }) => e.code);
      expect(bad).toBe('23514');
      const wrongAccount = await pool.query(`insert into integrations (account_id, scope, sub_account_id, provider) values ($1, 'sub_account', $2, 'x')`, [f.otherAccountId, f.bizA])
        .then(() => null, (e: { code: string }) => e.code);
      expect(wrongAccount).toBe('23503');
    } finally {
      await pool.end();
    }
  });
});

describe('dashboards, search and public links respect boundaries', () => {
  it('asking for business B numbers from a business A context returns zeros', async () => {
    const money = await asUser(f.ownerId, f.bizA, (tx) => getMoney(tx, [f.bizB], 'Australia/Melbourne'));
    expect(money.outstandingCents).toBe(0);
    const cards = await asUser(f.staffId, f.bizA, (tx) => getBusinessSummaries(tx, [f.bizA, f.bizB], 'Australia/Melbourne'));
    const b = cards.find((c) => c.subAccountId === f.bizB)!;
    expect(b.openLeads + b.outstandingCents + b.tasksToday).toBe(0);
  });

  it('search shows the same name in two businesses as two results, each with its business', async () => {
    const results = await asUser(f.ownerId, [f.bizA, f.bizB], (tx) => globalSearch(tx, [f.bizA, f.bizB], 'john smith'));
    const johns = results.filter((r) => r.type === 'contact');
    expect(new Set(johns.map((r) => r.subAccountId))).toEqual(new Set([f.bizA, f.bizB]));
    const staffResults = await asUser(f.staffId, f.bizA, (tx) => globalSearch(tx, [f.bizA, f.bizB], 'john smith'));
    expect(staffResults.every((r) => r.subAccountId === f.bizA)).toBe(true);
  });

  it('public tokens resolve only to their own business', async () => {
    const [inv] = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(invoices));
    const resolved = await raw({ actor: 'user', userId: null, subAccountIds: [] }, (tx) =>
      tx.execute<{ id: string }>(sql`select app.resolve_public('invoice', ${inv.publicToken}) as id`));
    expect(resolved.rows[0].id).toBe(f.bizA);
    const guess = await raw({ actor: 'user', userId: null, subAccountIds: [] }, (tx) =>
      tx.execute<{ id: string | null }>(sql`select app.resolve_public('invoice', 'not-a-real-token') as id`));
    expect(guess.rows[0].id).toBeNull();
    // A public visitor pinned to B cannot read A's invoice even with its id.
    const leak = await raw({ actor: 'public', subAccountId: f.bizB }, (tx) => tx.select().from(invoices).where(eq(invoices.id, inv.id)));
    expect(leak).toHaveLength(0);
  });

  it('document numbering refuses businesses you cannot write to', async () => {
    const code = await pgErrorCode(asUser(f.viewerId, f.bizB, (tx) => tx.execute(sql`select app.next_number(${f.bizB}::uuid, 'invoice')`)));
    expect(code).toBe('42501');
  });
});
