'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { accountMembers, subAccountMembers, userNotificationPrefs, users, integrations } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { MODULE_KEYS, MODULE_PRESETS } from '@/lib/modules/registry';
import { isValidAbn } from '@/lib/tax';
import { inBusiness, requireContext } from '@/server/context';
import { createBusiness, installBusinessDefaults, updateBusinessSettings } from '@/server/services/businesses';
import { connectBusinessIntegration, connectGlobalIntegration, disconnectIntegration } from '@/server/services/integrations';
import { markNotificationsRead } from '@/server/services/notifications';
import { ValidationError } from '@/server/services/_common';
import { switchBusiness } from './shell';
import { attempt, num, optStr, str } from './_util';

export async function saveBusinessDetailsAction(fd: FormData) {
  const ctx = await requireContext();
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const abn = optStr(fd, 'abn')?.replace(/\s/g, '') ?? null;
    if (abn && !isValidAbn(abn)) throw new ValidationError('That ABN does not pass the checksum. Double-check it.');
    await updateBusinessSettings(tx, s, {
      name: str(fd, 'name'), shortName: optStr(fd, 'shortName'), color: str(fd, 'color') || undefined, tradingName: optStr(fd, 'tradingName'), legalName: optStr(fd, 'legalName'),
      abn, acn: optStr(fd, 'acn'), phone: optStr(fd, 'phone'), email: optStr(fd, 'email'), website: optStr(fd, 'website'),
      address: { line1: str(fd, 'line1'), suburb: str(fd, 'suburb'), state: str(fd, 'state'), postcode: str(fd, 'postcode'), country: 'AU' },
      timezone: str(fd, 'timezone') || 'Australia/Melbourne', currency: str(fd, 'currency') || 'AUD', taxRegime: str(fd, 'taxRegime') || 'AU_GST',
      taxRegistered: str(fd, 'taxRegistered') === 'on', pricesIncludeTax: str(fd, 'pricesIncludeTax') === 'on',
      invoicePrefix: str(fd, 'invoicePrefix') || 'INV-', quotePrefix: str(fd, 'quotePrefix') || 'Q-', jobPrefix: str(fd, 'jobPrefix') || 'JOB-',
      paymentTermsDays: num(fd, 'paymentTermsDays') ?? 14, quoteValidityDays: num(fd, 'quoteValidityDays') ?? 30,
      invoiceTerms: optStr(fd, 'invoiceTerms'), quoteTerms: optStr(fd, 'quoteTerms'), bankDetails: optStr(fd, 'bankDetails'),
      branding: { logoUrl: optStr(fd, 'logoUrl') ?? undefined, invoiceAccent: optStr(fd, 'invoiceAccent') ?? undefined, quoteAccent: optStr(fd, 'quoteAccent') ?? undefined },
      terminology: { contact: optStr(fd, 'termContact') ?? undefined, contacts: optStr(fd, 'termContacts') ?? undefined, job: optStr(fd, 'termJob') ?? undefined, jobs: optStr(fd, 'termJobs') ?? undefined },
    });
  }), 'Business settings saved');
  revalidatePath('/', 'layout');
  return res;
}

export async function saveModulesAction(subAccountId: string, modules: string[]) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => updateBusinessSettings(tx, s, { enabledModules: modules.filter((m) => MODULE_KEYS.includes(m as never)) })).then(() => undefined), 'Modules updated');
  revalidatePath('/', 'layout');
  return res;
}

export async function addBusinessAction(fd: FormData) {
  const ctx = await requireContext();
  if (!ctx.isAccountAdmin) return { ok: false as const, error: 'Only the account owner can add businesses.' };
  const preset = (str(fd, 'preset') || 'everything') as keyof typeof MODULE_PRESETS;
  const res = await attempt(async () => {
    const b = await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, (tx) => createBusiness(tx, ctx.account.id, { name: str(fd, 'name'), preset, color: optStr(fd, 'color') ?? undefined }));
    await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [b.id] }, (tx) => installBusinessDefaults(tx, { subAccountId: b.id, userId: ctx.user.id, actor: 'user' }, preset));
    return { id: b.id };
  }, 'Business added');
  if (res.ok && res.data) await switchBusiness(res.data.id);
  revalidatePath('/', 'layout');
  return res;
}

export async function archiveBusinessAction(subAccountId: string, archive: boolean) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => updateBusinessSettings(tx, s, { archivedAt: archive ? new Date() : null })).then(() => undefined), archive ? 'Business archived' : 'Business restored');
  if (archive) await switchBusiness('all');
  revalidatePath('/', 'layout');
  return res;
}

export async function connectIntegrationAction(fd: FormData) {
  const ctx = await requireContext();
  const provider = str(fd, 'provider');
  const values: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !['provider', 'subAccountId', 'scope'].includes(k)) values[k] = v;
  const res = await attempt(async () => {
    if (str(fd, 'scope') === 'global') {
      if (!ctx.isAccountAdmin) throw new ValidationError('Only the account owner can change account-wide integrations.');
      await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, (tx) => connectGlobalIntegration(tx, ctx.account.id, provider, values));
    } else {
      await inBusiness(ctx, str(fd, 'subAccountId'), (tx, s) => connectBusinessIntegration(tx, s, provider, values));
    }
  }, 'Connected');
  revalidatePath('/settings/integrations');
  return res;
}

export async function disconnectIntegrationAction(id: string, subAccountId: string | null) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    if (subAccountId) await inBusiness(ctx, subAccountId, (tx) => disconnectIntegration(tx, id));
    else await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, async (tx) => {
      const [row] = await tx.select().from(integrations).where(and(eq(integrations.id, id), eq(integrations.scope, 'global')));
      if (!row) throw new ValidationError('Not found');
      await disconnectIntegration(tx, id);
    });
  }, 'Disconnected');
  revalidatePath('/settings/integrations');
  return res;
}

export async function inviteTeamMemberAction(fd: FormData) {
  const ctx = await requireContext();
  if (!ctx.isAccountAdmin) return { ok: false as const, error: 'Only the account owner can add team members.' };
  const res = await attempt(async () => {
    const email = str(fd, 'email').toLowerCase();
    const password = str(fd, 'password');
    if (password.length < 10) throw new ValidationError('Temporary password must be at least 10 characters.');
    const businessIds = fd.getAll('businesses').map(String).filter((id) => ctx.businesses.some((b) => b.id === id));
    const role = (str(fd, 'role') || 'staff') as 'admin' | 'staff' | 'viewer';
    await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: businessIds }, async (tx) => {
      // No RETURNING: the new user only becomes visible (RLS) once they're an account member.
      const id = randomUUID();
      await tx.insert(users).values({ id, email, name: str(fd, 'name') || email, passwordHash: await hashPassword(password) });
      await tx.insert(accountMembers).values({ accountId: ctx.account.id, userId: id, role: 'member' });
      if (businessIds.length) await tx.insert(subAccountMembers).values(businessIds.map((b) => ({ subAccountId: b, userId: id, role })));
    });
  }, 'Team member added. Share the temporary password with them.');
  revalidatePath('/settings/team');
  return res;
}

export async function removeMembershipAction(subAccountId: string, userId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx) => tx.delete(subAccountMembers).where(and(eq(subAccountMembers.subAccountId, subAccountId), eq(subAccountMembers.userId, userId)))).then(() => undefined), 'Access removed');
  revalidatePath('/settings/team');
  return res;
}

export async function saveNotificationPrefsAction(fd: FormData) {
  const ctx = await requireContext();
  const types = fd.getAll('types').map(String);
  const enabled = new Set(fd.getAll('inApp').map(String));
  const res = await attempt(() => withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, async (tx) => {
    for (const t of types) {
      await tx.insert(userNotificationPrefs).values({ userId: ctx.user.id, eventType: t, inApp: enabled.has(t) })
        .onConflictDoUpdate({ target: [userNotificationPrefs.userId, userNotificationPrefs.eventType], set: { inApp: enabled.has(t) } });
    }
  }), 'Preferences saved');
  revalidatePath('/settings/notifications');
  return res;
}

export async function changePasswordAction(fd: FormData) {
  const ctx = await requireContext();
  return attempt(() => withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.user.id));
    if (!(await verifyPassword(str(fd, 'current'), u.passwordHash))) throw new ValidationError('Current password is wrong.');
    const next = str(fd, 'next');
    if (next.length < 10) throw new ValidationError('Use at least 10 characters.');
    await tx.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
  }), 'Password changed');
}

export async function markAllReadAction() {
  const ctx = await requireContext();
  await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.scopeIds }, (tx) => markNotificationsRead(tx, 'all'));
  revalidatePath('/', 'layout');
}
