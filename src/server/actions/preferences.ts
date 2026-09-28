'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { requireContext } from '@/server/context';

/** Per-device display preference; dark unless changed. */
export async function setThemeAction(theme: string) {
  await requireContext();
  (await cookies()).set(THEME_COOKIE, parseTheme(theme), { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', httpOnly: false });
  revalidatePath('/', 'layout');
}
