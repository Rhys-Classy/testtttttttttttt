import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { withContext } from '@/db/context';
import { accountMembers, auditLog, contacts, invoices, leads, notifications, roles, subAccountMembers, subAccounts, tasks } from '@/db/schema';
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS, type Grant } from '@/lib/permissions';
import { inBusiness, type AppContext } from '@/server/context';
import { createContact, createLead } from '@/server/services/crm';
import { createInvoice } from '@/server/services/finance';
import { createJob, createTask } from '@/server/services/work';
import { createBusiness } from '@/server/services/businesses';
import { ForbiddenError, NotFoundError } from '@/server/services/_common';
import { admin, asSystem, asUser, createFixture, createMember, grantRole, pgErrorCode, raw, type Fixture } from './helpers';

let f: Fixture;
let assignedContact: string;
let otherContact: string;
let staffTask: string;
let otherTask: string;

/** The same context the app builds per request, loaded from the database. */
async function ctxFor(userId: string): Promise<AppContext> {
  return withContext({ actor: 'user', userId, subAccountIds: [] }, async (tx) => {
    const grants: Record<string, Grant> = {};
    const rows = (await tx.execute<{ sub_account_id: string; permissions: string[]; assigned_only: boolean; role_name: string }>(sql`select * from app.my_grants()`)).rows;
    for (const g of rows) grants[g.sub_account_id] = { permissions: g.permissions.includes('*') ? '*' : new Set(g.permissions), assignedOnly: g.assigned_only, roleName: g.role_name };
    const businesses = await tx.select().from(subAccounts);
    return {
      user: { id: userId, name: 'Test', email: 't@test', timezone: 'Australia/Melbourne', mfaEnabled: false },
      account: { id: f.accountId, name: 'Test', role: 'member', settings: {} }, isOwner: false,
      businesses: businesses.filter((b) => grants[b.id]), current: null, scopeIds: businesses.map((b) => b.id), grants, tz: 'Australia/Melbourne', ip: null,
    };
  });
}

beforeAll(async () => {
  f = await createFixture();
  await asUser(f.ownerId, f.bizA, async (tx, s) => {
    assignedContact = (await createContact(tx, s, { name: 'Assigned Customer' })).id;
    otherContact = (await createContact(tx, s, { name: 'Someone Else' })).id;
    await createJob(tx, s, { title: 'Install for assigned', contactId: assignedContact, assignedUserId: f.staffId });
    await createJob(tx, s, { title: 'Install for other', contactId: otherContact });
    staffTask = (await createTask(tx, s, { title: 'Staff task', assigneeUserId: f.staffId })).id;
    otherTask = (await createTask(tx, s, { title: 'Owner task' })).id;
    await createInvoice(tx, s, { contactId: assignedContact, lines: [{ description: 'Doors', quantity: 1, unitPriceCents: 50_000 }] });
    await createLead(tx, s, { name: 'Lead Person', source: 'website' });
  });
});

afterAll(async () => { await closeDb(); });

describe('roles', () => {
  it('the database installs the same starting roles as src/lib/permissions.ts', async () => {
    const rows = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(roles).where(eq(roles.accountId, f.accountId)));
    for (const key of SYSTEM_ROLE_KEYS) {
      const r = rows.find((x) => x.key === key);
      expect(r, key).toBeTruthy();
      expect(new Set(r!.permissions)).toEqual(new Set(SYSTEM_ROLES[key].permissions));
      expect(r!.dataScope).toBe(SYSTEM_ROLES[key].dataScope);
      expect(r!.name).toBe(SYSTEM_ROLES[key].name);
    }
  });

  it('owners hold every permission; others only what their role grants, per business', async () => {
    const check = (userId: string, sub: string, perm: string) => raw({ actor: 'user', userId, subAccountIds: [sub] }, async (tx) =>
      (await tx.execute<{ ok: boolean }>(sql`select app.has_permission(${sub}::uuid, ${perm}) as ok`)).rows[0].ok);
    expect(await check(f.ownerId, f.bizA, 'payments.refund')).toBe(true);
    expect(await check(f.staffId, f.bizA, 'tasks.edit')).toBe(true);
    expect(await check(f.staffId, f.bizA, 'invoices.view')).toBe(false);
    expect(await check(f.staffId, f.bizB, 'tasks.edit')).toBe(false);
    expect(await check(f.viewerId, f.bizB, 'contacts.view')).toBe(true);
    expect(await check(f.viewerId, f.bizB, 'contacts.edit')).toBe(false);
    expect(await check(f.outsiderId, f.bizA, 'contacts.view')).toBe(false);
  });
});

describe('Staff: only what is assigned to them', () => {
  it('sees contacts linked to their jobs/tasks, not everyone', async () => {
    const rows = await asUser(f.staffId, f.bizA, (tx) => tx.select().from(contacts));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(assignedContact);
    expect(ids).not.toContain(otherContact);
  });

  it('sees only their own tasks and jobs', async () => {
    const t = await asUser(f.staffId, f.bizA, (tx) => tx.select().from(tasks));
    expect(t.map((x) => x.id)).toEqual([staffTask]);
  });

  it('cannot see invoices or leads at all (not in the Staff role)', async () => {
    expect(await asUser(f.staffId, f.bizA, (tx) => tx.select().from(invoices))).toHaveLength(0);
    expect(await asUser(f.staffId, f.bizA, (tx) => tx.select().from(leads))).toHaveLength(0);
  });

  it('cannot create an invoice even by calling the database directly', async () => {
    const code = await pgErrorCode(asUser(f.staffId, f.bizA, (tx, s) => createInvoice(tx, s, { contactId: assignedContact, lines: [{ description: 'x', quantity: 1, unitPriceCents: 100 }] })));
    expect(code).toBe('42501');
  });

  it('app writes: permission is checked first, then targeted records must be visible to them', async () => {
    const ctx = await ctxFor(f.staffId);
    // Own task: allowed.
    await inBusiness(ctx, f.bizA, 'tasks.edit', (tx, s) => tx.update(tasks).set({ title: 'Staff task (edited)' }).where(eq(tasks.id, staffTask)).then(() => s), { visible: [['tasks', staffTask]] });
    // Someone else's task in the same business: not found for them.
    await expect(inBusiness(ctx, f.bizA, 'tasks.edit', async () => 'nope', { visible: [['tasks', otherTask]] })).rejects.toBeInstanceOf(NotFoundError);
    // A permission their role lacks.
    await expect(inBusiness(ctx, f.bizA, 'invoices.edit', async () => 'nope')).rejects.toBeInstanceOf(ForbiddenError);
    // A business they aren't in.
    await expect(inBusiness(ctx, f.bizB, 'tasks.edit', async () => 'nope')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not see business-wide notifications about money', async () => {
    await asSystem(f.bizA, (tx) => tx.insert(notifications).values([
      { subAccountId: f.bizA, type: 'invoice.overdue', title: 'INV overdue' },
      { subAccountId: f.bizA, type: 'task.overdue', title: 'Your task', userId: f.staffId },
    ]));
    const staffSees = await asUser(f.staffId, f.bizA, (tx) => tx.select().from(notifications));
    expect(staffSees.map((n) => n.title)).toEqual(['Your task']);
    const ownerSees = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(notifications));
    expect(ownerSees.map((n) => n.title)).toContain('INV overdue');
  });
});

describe('Accountant, Manager and all-businesses roles', () => {
  it('Accountant sees money but not the sales pipeline', async () => {
    const acct = await createMember(f.accountId, 'accountant');
    await grantRole(acct, f.bizA, 'accountant');
    expect((await asUser(acct, f.bizA, (tx) => tx.select().from(invoices))).length).toBeGreaterThan(0);
    expect(await asUser(acct, f.bizA, (tx) => tx.select().from(leads))).toHaveLength(0);
    const ctx = await ctxFor(acct);
    const inv = await inBusiness(ctx, f.bizA, 'invoices.edit', (tx, s) => createInvoice(tx, s, { contactId: assignedContact, lines: [{ description: 'Adjustment', quantity: 1, unitPriceCents: 1000 }] }));
    expect(inv.number).toMatch(/^INV-/);
  });

  it('Manager cannot see invoices or number them', async () => {
    const mgr = await createMember(f.accountId, 'manager');
    await grantRole(mgr, f.bizA, 'manager');
    expect(await asUser(mgr, f.bizA, (tx) => tx.select().from(invoices))).toHaveLength(0);
    expect((await asUser(mgr, f.bizA, (tx) => tx.select().from(leads))).length).toBeGreaterThan(0);
    const code = await pgErrorCode(asUser(mgr, f.bizA, (tx) => tx.execute(sql`select app.next_number(${f.bizA}::uuid, 'invoice')`)));
    expect(code).toBe('42501');
  });

  it('an all-businesses role covers every business, including ones added later; a business role overrides it', async () => {
    const pool = admin();
    const m = await createMember(f.accountId, 'all-viewer');
    const viewerRole = (await pool.query(`select id from roles where account_id = $1 and key = 'viewer'`, [f.accountId])).rows[0].id;
    await pool.query(`update account_members set all_businesses_role_id = $1 where user_id = $2`, [viewerRole, m]);
    await pool.end();
    const bizC = (await withContext({ actor: 'user', userId: f.ownerId, subAccountIds: [] }, (tx) => createBusiness(tx, f.accountId, { name: 'Charlie Furniture', preset: 'everything' }))).id;
    const visible = await raw({ actor: 'user', userId: m, subAccountIds: [] }, (tx) => tx.select({ id: subAccounts.id }).from(subAccounts));
    expect(new Set(visible.map((v) => v.id))).toEqual(new Set([f.bizA, f.bizB, bizC]));
    // Read-only everywhere…
    expect(await pgErrorCode(asUser(m, f.bizB, (tx, s) => createContact(tx, s, { name: 'Nope' })))).toBe('42501');
    // …except where given a business role.
    await grantRole(m, f.bizB, 'admin');
    await asUser(m, f.bizB, (tx, s) => createContact(tx, s, { name: 'Allowed now' }));
  });
});

describe('no privilege escalation', () => {
  it('a team manager cannot hand out a role more powerful than their own, or change their own access', async () => {
    const pool = admin();
    // Custom role: Manager + team.manage.
    const mgrPerms = [...SYSTEM_ROLES.manager.permissions, 'team.manage'];
    const { rows } = await pool.query(`insert into roles (account_id, name, permissions) values ($1, 'Team lead', $2) returning id`, [f.accountId, mgrPerms]);
    const lead = await createMember(f.accountId, 'lead');
    await pool.query(`insert into sub_account_members (sub_account_id, user_id, role_id) values ($1, $2, $3)`, [f.bizA, lead, rows[0].id]);
    const adminRole = (await pool.query(`select id from roles where account_id = $1 and key = 'admin'`, [f.accountId])).rows[0].id;
    const staffRole = (await pool.query(`select id from roles where account_id = $1 and key = 'staff'`, [f.accountId])).rows[0].id;
    await pool.end();
    const newbie = await createMember(f.accountId, 'newbie');
    // Staff ⊂ Team lead: fine.
    await raw({ actor: 'user', userId: lead, subAccountIds: [f.bizA] }, (tx) => tx.insert(subAccountMembers).values({ subAccountId: f.bizA, userId: newbie, roleId: staffRole }));
    // Admin ⊄ Team lead: refused.
    expect(await pgErrorCode(raw({ actor: 'user', userId: lead, subAccountIds: [f.bizA] }, (tx) =>
      tx.update(subAccountMembers).set({ roleId: adminRole }).where(eq(subAccountMembers.userId, newbie))))).toBe('42501');
    // Own membership: invisible to update.
    const mine = await raw({ actor: 'user', userId: lead, subAccountIds: [f.bizA] }, (tx) =>
      tx.update(subAccountMembers).set({ roleId: adminRole }).where(eq(subAccountMembers.userId, lead)).returning());
    expect(mine).toHaveLength(0);
    // Business they don't manage.
    expect(await pgErrorCode(raw({ actor: 'user', userId: lead, subAccountIds: [f.bizB] }, (tx) =>
      tx.insert(subAccountMembers).values({ subAccountId: f.bizB, userId: newbie, roleId: staffRole })))).toBe('42501');
    // Roles and all-businesses access are owner-only.
    expect(await pgErrorCode(raw({ actor: 'user', userId: lead, subAccountIds: [] }, (tx) =>
      tx.insert(roles).values({ accountId: f.accountId, name: 'Sneaky', permissions: ['payments.refund'] })))).toBe('42501');
    const upd = await raw({ actor: 'user', userId: lead, subAccountIds: [] }, (tx) =>
      tx.update(accountMembers).set({ allBusinessesRoleId: adminRole }).where(eq(accountMembers.userId, newbie)).returning());
    expect(upd).toHaveLength(0);
  });

  it('roles from another master account cannot be used', async () => {
    const pool = admin();
    try {
      const foreignRole = (await pool.query(`select id from roles where account_id = $1 and key = 'admin'`, [f.otherAccountId])).rows[0].id;
      const m = await createMember(f.accountId, 'crossrole');
      await expect(pool.query(`insert into sub_account_members (sub_account_id, user_id, role_id) values ($1, $2, $3)`, [f.bizA, m, foreignRole])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.end();
    }
  });
});

describe('secrets and audit', () => {
  it('the runtime role cannot read password hashes or MFA secrets', async () => {
    expect(await pgErrorCode(raw({ actor: 'user', userId: f.ownerId, subAccountIds: [] }, (tx) => tx.execute(sql`select password_hash from users`)))).toBe('42501');
    expect(await pgErrorCode(raw({ actor: 'user', userId: f.ownerId, subAccountIds: [] }, (tx) => tx.execute(sql`select mfa_secret_encrypted from users`)))).toBe('42501');
  });

  it('changes are recorded automatically with who did it, and the log cannot be edited', async () => {
    const ctx = await ctxFor(f.ownerId);
    const c = await inBusiness({ ...ctx, isOwner: true }, f.bizA, 'contacts.edit', (tx, s) => createContact(tx, s, { name: 'Audited Person' }));
    const rows = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, c.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'contact.created', actorUserId: f.ownerId, actor: 'user', entityLabel: 'Audited Person', accountId: f.accountId });
    expect(await pgErrorCode(asUser(f.ownerId, f.bizA, (tx) => tx.update(auditLog).set({ action: 'x' }).where(eq(auditLog.id, rows[0].id))))).toBe('42501');
    expect(await pgErrorCode(asUser(f.ownerId, f.bizA, (tx) => tx.delete(auditLog).where(eq(auditLog.id, rows[0].id))))).toBe('42501');
    expect(await pgErrorCode(asUser(f.ownerId, f.bizA, (tx) => tx.insert(auditLog).values({ accountId: f.accountId, subAccountId: f.bizA, action: 'fake' })))).toBe('42501');
  });

  it('only people with audit.view can read the log', async () => {
    expect(await asUser(f.staffId, f.bizA, (tx) => tx.select().from(auditLog))).toHaveLength(0);
    expect((await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(auditLog))).length).toBeGreaterThan(0);
  });

  it('status changes read as events (e.g. invoice.sent), with before/after values', async () => {
    const inv = await asUser(f.ownerId, f.bizA, (tx, s) => createInvoice(tx, s, { contactId: assignedContact, lines: [{ description: 'Panels', quantity: 1, unitPriceCents: 20_000 }] }));
    await asUser(f.ownerId, f.bizA, (tx) => tx.update(invoices).set({ status: 'sent' }).where(eq(invoices.id, inv.id)));
    const rows = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, inv.id)));
    expect(rows.map((r) => r.action).sort()).toEqual(['invoice.created', 'invoice.sent']);
    const sent = rows.find((r) => r.action === 'invoice.sent')!;
    expect((sent.data as { changed: Record<string, unknown> }).changed.status).toEqual(['draft', 'sent']);
  });
});
