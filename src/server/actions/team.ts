'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withContext } from '@/db/context';
import type { Tx } from '@/db/client';
import { accountMembers, apiKeys, roles, subAccountMembers, subAccounts, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { randomToken, sha256 } from '@/lib/crypto';
import { grantAllows, isPermission, type Permission } from '@/lib/permissions';
import { requireContext, type AppContext } from '@/server/context';
import { ForbiddenError, ValidationError } from '@/server/services/_common';
import { attempt } from './_util';

/** Platform tables (people, roles, keys) are protected by their own RLS policies; this runs as the user. */
function asMe<T>(ctx: AppContext, fn: (tx: Tx) => Promise<T>) {
  return withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.businesses.map((b) => b.id), ip: ctx.ip }, fn);
}

const uuid = z.string().uuid();

/** "role_<businessId>" fields → { businessId: roleId | null }, limited to businesses the user can see. */
function businessRoles(ctx: AppContext, fd: FormData) {
  const out: Record<string, string | null> = {};
  for (const b of ctx.businesses) {
    const v = fd.get(`role_${b.id}`);
    if (typeof v !== 'string') continue;
    out[b.id] = v === '' ? null : uuid.parse(v);
  }
  return out;
}

const inviteSchema = z.object({
  name: z.string().trim().min(1, 'Add their name.').max(120),
  email: z.string().trim().toLowerCase().email('That email doesn’t look right.').max(200),
  password: z.string().min(10, 'Temporary password must be at least 10 characters.').max(200),
  allRoleId: z.union([uuid, z.literal('')]).optional(),
});

export async function inviteTeamMemberAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const parsed = inviteSchema.safeParse(Object.fromEntries(['name', 'email', 'password', 'allRoleId'].map((k) => [k, fd.get(k) ?? undefined])));
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
    const { name, email, password } = parsed.data;
    const allRoleId = parsed.data.allRoleId || null;
    if (allRoleId && !ctx.isOwner) throw new ForbiddenError('Only the account owner can give access to every business.');
    const perBusiness = Object.entries(businessRoles(ctx, fd)).filter(([, r]) => r) as [string, string][];
    if (!allRoleId && !perBusiness.length) throw new ValidationError('Give them a role in at least one business.');
    await asMe(ctx, async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing) throw new ValidationError('That person already has a login in this account.');
      // No RETURNING: the new user only becomes visible (RLS) once they're an account member.
      const id = randomUUID();
      await tx.insert(users).values({ id, email, name, passwordHash: await hashPassword(password) });
      await tx.insert(accountMembers).values({ accountId: ctx.account.id, userId: id, role: 'member', allBusinessesRoleId: allRoleId });
      if (perBusiness.length) await tx.insert(subAccountMembers).values(perBusiness.map(([subAccountId, roleId]) => ({ subAccountId, userId: id, roleId })));
    });
  }, 'Team member added. Share the temporary password with them — they should change it and turn on two-step verification.', 'adding the team member');
  revalidatePath('/settings/team');
  return res;
}

/** Set someone's role per business (and, for owners, their all-businesses role). */
export async function updateMemberAccessAction(userId: string, fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    uuid.parse(userId);
    if (userId === ctx.user.id) throw new ValidationError('You can’t change your own access.');
    const wanted = businessRoles(ctx, fd);
    await asMe(ctx, async (tx) => {
      if (ctx.isOwner && fd.has('allRoleId')) {
        const v = String(fd.get('allRoleId') ?? '');
        await tx.update(accountMembers).set({ allBusinessesRoleId: v ? uuid.parse(v) : null })
          .where(and(eq(accountMembers.accountId, ctx.account.id), eq(accountMembers.userId, userId)));
      }
      for (const [subAccountId, roleId] of Object.entries(wanted)) {
        if (!ctx.isOwner && !grantAllows(ctx.grants[subAccountId], 'team.manage')) continue;
        if (roleId) {
          await tx.insert(subAccountMembers).values({ subAccountId, userId, roleId })
            .onConflictDoUpdate({ target: [subAccountMembers.subAccountId, subAccountMembers.userId], set: { roleId } });
        } else {
          await tx.delete(subAccountMembers).where(and(eq(subAccountMembers.subAccountId, subAccountId), eq(subAccountMembers.userId, userId)));
        }
      }
    });
  }, 'Access updated', 'updating their access');
  revalidatePath('/settings/team');
  return res;
}

export async function removeMemberAction(userId: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    uuid.parse(userId);
    if (!ctx.isOwner) throw new ForbiddenError('Only the account owner can remove people.');
    if (userId === ctx.user.id) throw new ValidationError('You can’t remove yourself.');
    await asMe(ctx, async (tx) => {
      const ids = (await tx.select({ id: subAccounts.id }).from(subAccounts).where(eq(subAccounts.accountId, ctx.account.id))).map((r) => r.id);
      if (ids.length) await tx.delete(subAccountMembers).where(and(eq(subAccountMembers.userId, userId), inArray(subAccountMembers.subAccountId, ids)));
      await tx.delete(accountMembers).where(and(eq(accountMembers.accountId, ctx.account.id), eq(accountMembers.userId, userId)));
    });
  }, 'Removed. They can no longer log in to this account.', 'removing them');
  revalidatePath('/settings/team');
  return res;
}

const roleSchema = z.object({
  id: z.union([uuid, z.literal('')]),
  name: z.string().trim().min(1, 'Give the role a name.').max(60),
  description: z.string().trim().max(300),
  dataScope: z.enum(['all', 'assigned']),
  permissions: z.array(z.string()).transform((a) => a.filter(isPermission)),
});

/** Owner-only: create a custom role or change any role's permissions. */
export async function saveRoleAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    if (!ctx.isOwner) throw new ForbiddenError('Only the account owner can change roles.');
    const p = roleSchema.safeParse({
      id: fd.get('id') ?? '', name: fd.get('name') ?? '', description: fd.get('description') ?? '',
      dataScope: fd.get('dataScope') ?? 'all', permissions: fd.getAll('permissions').map(String),
    });
    if (!p.success) throw new ValidationError(p.error.issues[0].message);
    const values = { name: p.data.name, description: p.data.description || null, dataScope: p.data.dataScope, permissions: p.data.permissions, updatedAt: new Date() };
    await asMe(ctx, (tx) => p.data.id
      ? tx.update(roles).set(values).where(and(eq(roles.id, p.data.id), eq(roles.accountId, ctx.account.id)))
      : tx.insert(roles).values({ ...values, accountId: ctx.account.id }));
  }, 'Role saved', 'saving the role');
  revalidatePath('/settings/roles');
  revalidatePath('/settings/team');
  return res;
}

export async function deleteRoleAction(id: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    uuid.parse(id);
    if (!ctx.isOwner) throw new ForbiddenError('Only the account owner can delete roles.');
    await asMe(ctx, async (tx) => {
      const [r] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.accountId, ctx.account.id)));
      if (!r) throw new ValidationError('Role not found.');
      if (r.key) throw new ValidationError('Starting roles can be edited but not deleted.');
      const [used] = await tx.select({ u: subAccountMembers.userId }).from(subAccountMembers).where(eq(subAccountMembers.roleId, id)).limit(1);
      if (used) throw new ValidationError('Someone still has this role. Change their access first.');
      await tx.delete(roles).where(eq(roles.id, id));
    });
  }, 'Role deleted');
  revalidatePath('/settings/roles');
  return res;
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

const apiKeySchema = z.object({
  subAccountId: uuid,
  name: z.string().trim().min(1, 'Name the key (e.g. "Zapier").').max(60),
  permissions: z.array(z.string()).transform((a) => a.filter(isPermission)).refine((a) => a.length > 0, 'Tick at least one permission.'),
  expiresInDays: z.coerce.number().int().min(0).max(3650),
});

/** Creates a key for ONE business. The full key is shown once; only its hash is stored. */
export async function createApiKeyAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const p = apiKeySchema.safeParse({
      subAccountId: fd.get('subAccountId'), name: fd.get('name') ?? '', permissions: fd.getAll('permissions').map(String), expiresInDays: fd.get('expiresInDays') ?? 0,
    });
    if (!p.success) throw new ValidationError(p.error.issues[0].message);
    const grant = ctx.grants[p.data.subAccountId];
    if (!grantAllows(grant, 'integrations.manage')) throw new ForbiddenError('You need permission to manage integrations in that business.');
    // A key can never do more than the person creating it.
    const perms = p.data.permissions.filter((x) => grantAllows(grant, x as Permission));
    const key = `bos_${randomToken(30)}`;
    await asMe(ctx, (tx) => tx.insert(apiKeys).values({
      subAccountId: p.data.subAccountId, name: p.data.name, prefix: key.slice(0, 12), keyHash: sha256(key), permissions: perms,
      createdByUserId: ctx.user.id, expiresAt: p.data.expiresInDays ? new Date(Date.now() + p.data.expiresInDays * 86_400_000) : null,
    }));
    return { key };
  }, 'API key created — copy it now, it won’t be shown again.', 'creating the API key');
  revalidatePath('/settings/api');
  return res;
}

export async function revokeApiKeyAction(id: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    uuid.parse(id);
    await asMe(ctx, async (tx) => {
      const r = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
      if (!r.length) throw new ValidationError('Key not found.');
    });
  }, 'Key revoked');
  revalidatePath('/settings/api');
  return res;
}
