'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { eq } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { accounts } from '@/db/schema';
import {
  beginMfaEnrolment, changePassword, completeMfaLogin, confirmMfaEnrolment, disableMfa, finishMfaEnrolment, getSession, login,
  regenerateRecoveryCodes, revokeSession,
} from '@/server/auth';
import { requireContext } from '@/server/context';
import { rateLimited } from '@/lib/rate-limit';
import { z } from 'zod';

type FormState = { error?: string; recoveryCodes?: string[]; ok?: boolean } | undefined;

const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!parsed.success) return { error: 'Enter your email and password.' };
  const res = await login(parsed.data.email, parsed.data.password);
  if (!res.ok) return { error: res.error };
  redirect(res.mfa ? '/login/verify' : '/');
}

export async function verifyMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const code = String(fd.get('code') ?? '').slice(0, 20);
  const res = await completeMfaLogin(code);
  if (!res.ok) {
    if (res.restart) redirect('/login');
    return { error: res.error };
  }
  redirect('/');
}

/** Signed-in (or forced-setup) user: who are we? */
async function sessionUser() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session.userId;
}

export async function startMfaSetupAction(email: string): Promise<{ secret: string; qrSvg: string }> {
  const userId = await sessionUser();
  const { secret, uri } = await beginMfaEnrolment(userId, email);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#0f1216', light: '#ffffff' } });
  return { secret, qrSvg };
}

export async function confirmMfaSetupAction(_: FormState, fd: FormData): Promise<FormState> {
  const userId = await sessionUser();
  if (rateLimited(`mfa-enrol|${userId}`, 10, 10 * 60_000)) return { error: 'Too many attempts. Try again in 10 minutes.' };
  const res = await confirmMfaEnrolment(userId, String(fd.get('code') ?? ''));
  if (!res.ok) return { error: res.error };
  // No revalidate here: the page must keep showing the recovery codes until they're saved.
  return { ok: true, recoveryCodes: res.recoveryCodes };
}

/** "I've saved my recovery codes": clear the setup cookie (this also refreshes the page). */
export async function finishMfaSetupAction() {
  await sessionUser();
  await finishMfaEnrolment();
}

export async function disableMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireContext();
  if (ctx.account.settings.requireMfa) return { error: 'Your account requires two-step verification, so it can’t be switched off.' };
  if (rateLimited(`mfa-disable|${ctx.user.id}`, 5, 10 * 60_000)) return { error: 'Too many attempts. Try again in 10 minutes.' };
  const res = await disableMfa(ctx.user.id, String(fd.get('password') ?? ''), String(fd.get('code') ?? ''));
  if (!res.ok) return { error: res.error };
  revalidatePath('/settings/account');
  return { ok: true };
}

export async function regenerateRecoveryCodesAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireContext();
  if (rateLimited(`mfa-regen|${ctx.user.id}`, 5, 10 * 60_000)) return { error: 'Too many attempts. Try again in 10 minutes.' };
  const res = await regenerateRecoveryCodes(ctx.user.id, String(fd.get('code') ?? ''));
  if (!res.ok) return { error: res.error };
  return { ok: true, recoveryCodes: res.recoveryCodes };
}

export async function changePasswordAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await changePassword(ctx.user.id, String(fd.get('current') ?? ''), String(fd.get('next') ?? ''));
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath('/settings/account');
  return { ok: true as const, message: 'Password changed. Other devices were signed out.' };
}

export async function revokeSessionAction(sessionId: string) {
  const ctx = await requireContext();
  if (sessionId !== 'others' && !z.string().uuid().safeParse(sessionId).success) return;
  await revokeSession(ctx.user.id, sessionId);
  revalidatePath('/settings/account');
}

const accountSecuritySchema = z.object({
  requireMfa: z.boolean(),
  sessionIdleMinutes: z.number().int().min(15).max(60 * 24 * 30),
});

/** Owner-only: account-wide sign-in rules. */
export async function saveAccountSecurityAction(fd: FormData) {
  const ctx = await requireContext();
  if (!ctx.isOwner) return { ok: false as const, error: 'Only the account owner can change sign-in rules.' };
  const parsed = accountSecuritySchema.safeParse({
    requireMfa: fd.get('requireMfa') === 'on',
    sessionIdleMinutes: Number(fd.get('sessionIdleMinutes') ?? 0),
  });
  if (!parsed.success) return { ok: false as const, error: 'Pick an idle timeout between 15 minutes and 30 days.' };
  if (parsed.data.requireMfa && !ctx.user.mfaEnabled) return { ok: false as const, error: 'Turn on two-step verification for yourself first.' };
  await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [], ip: ctx.ip }, (tx) =>
    tx.update(accounts).set({ settings: { ...ctx.account.settings, ...parsed.data }, updatedAt: new Date() }).where(eq(accounts.id, ctx.account.id)));
  revalidatePath('/settings/account');
  return { ok: true as const, message: 'Saved' };
}
