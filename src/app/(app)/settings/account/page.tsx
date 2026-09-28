import { cookies } from 'next/headers';
import { desc, eq } from 'drizzle-orm';
import { MonitorSmartphone } from 'lucide-react';
import { withContext } from '@/db/context';
import { sessions } from '@/db/schema';
import { relativeTime } from '@/lib/dates';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { getSession, recoveryCodesLeft } from '@/server/auth';
import { requireContext } from '@/server/context';
import { changePasswordAction, saveAccountSecurityAction } from '@/server/actions/security';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActionForm } from '@/components/action-form';
import { MfaSetup } from '@/components/security/mfa-setup';
import { ThemePicker } from './theme-picker';
import { MfaManage, RevokeButton } from './security-bits';

export const metadata = { title: 'My account' };

const IDLE_OPTIONS = [
  [60, '1 hour'], [8 * 60, '8 hours'], [24 * 60, '1 day'], [7 * 24 * 60, '7 days'], [30 * 24 * 60, '30 days'],
] as const;

function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

export default async function AccountPage() {
  const ctx = await requireContext();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const current = await getSession();
  const mySessions = await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: [] }, (tx) =>
    tx.select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, lastSeenAt: sessions.lastSeenAt, createdAt: sessions.createdAt })
      .from(sessions).where(eq(sessions.userId, ctx.user.id)).orderBy(desc(sessions.lastSeenAt)).limit(20));
  const codesLeft = ctx.user.mfaEnabled ? await recoveryCodesLeft(ctx.user.id) : 0;
  const idle = ctx.account.settings.sessionIdleMinutes ?? 7 * 24 * 60;

  return (
    <div className="space-y-5">
      <PageHeader title="My account" subtitle={`${ctx.user.name} · ${ctx.user.email}`} />

      <Card><CardHeader title="Appearance" subtitle="Saved on this device" /><CardBody><ThemePicker current={theme} /></CardBody></Card>

      <Card>
        <CardHeader title="Two-step verification" action={ctx.user.mfaEnabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>} />
        <CardBody>
          {ctx.user.mfaEnabled
            ? <MfaManage codesLeft={codesLeft} required={!!ctx.account.settings.requireMfa} />
            : <MfaSetup email={ctx.user.email} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where you’re signed in" action={mySessions.length > 1 ? <RevokeButton id="others" label="Sign out everywhere else" /> : null} />
        <CardBody className="divide-y divide-border">
          {mySessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <MonitorSmartphone className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{deviceName(s.userAgent)} {s.id === current?.sessionId ? <Badge tone="accent" className="ml-1">This device</Badge> : null}</p>
                <p className="text-xs text-muted">Active {relativeTime(s.lastSeenAt)}{s.ip ? ` · ${s.ip}` : ''} · signed in {relativeTime(s.createdAt)}</p>
              </div>
              {s.id !== current?.sessionId ? <RevokeButton id={s.id} label="Sign out" /> : null}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card><CardHeader title="Change password" subtitle="Signs out your other devices" /><CardBody>
        <ActionForm action={changePasswordAction} resetOnSuccess className="max-w-sm space-y-3">
          <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 10 characters. A few random words works well."><Input name="next" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></Field>
          <Button type="submit" variant="primary">Change password</Button>
        </ActionForm>
      </CardBody></Card>

      {ctx.isOwner ? (
        <Card><CardHeader title="Sign-in rules for everyone" subtitle="Account owner only" /><CardBody>
          <ActionForm action={saveAccountSecurityAction} className="max-w-md space-y-4">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="requireMfa" defaultChecked={!!ctx.account.settings.requireMfa} className="mt-0.5 size-4 accent-(--accent)" />
              <span><span className="font-medium">Require two-step verification</span><span className="block text-muted">People without it are asked to set it up before they can continue.</span></span>
            </label>
            <Field label="Sign out after inactivity">
              <Select name="sessionIdleMinutes" defaultValue={String(IDLE_OPTIONS.find(([m]) => m === idle)?.[0] ?? 7 * 24 * 60)}>
                {IDLE_OPTIONS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="primary">Save</Button>
          </ActionForm>
        </CardBody></Card>
      ) : null}

      <Card><CardHeader title="Keyboard shortcuts" /><CardBody className="space-y-1 text-sm">
        <p><kbd className="rounded border border-border px-1.5">Ctrl/⌘ K</kbd> command centre — search or say what to do</p>
        <p><kbd className="rounded border border-border px-1.5">/</kbd> open search</p>
        <p><kbd className="rounded border border-border px-1.5">Alt N</kbd> quick add</p>
        <p><kbd className="rounded border border-border px-1.5">Ctrl/⌘ Enter</kbd> send a message in the inbox</p>
      </CardBody></Card>
    </div>
  );
}
