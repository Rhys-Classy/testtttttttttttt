import { and, isNull, or, eq, sql } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import { MODULES } from '@/lib/modules/registry';
import { tzOffsetMinutes } from '@/lib/dates';
import { can, canAdminister, readScope, requireContext } from '@/server/context';
import { logout } from '@/server/auth';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { TopBar } from '@/components/shell/top-bar';
import { CommandPalette } from '@/components/shell/command-palette';
import { QuickAdd } from '@/components/shell/quick-add';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { Toaster } from '@/components/toast';
import type { ShellData } from '@/components/shell/types';

async function logoutAction() {
  'use server';
  await logout();
  redirect('/login');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const scope = ctx.current ? [ctx.current] : ctx.businesses;
  const enabled = new Set(scope.flatMap((b) => b.enabledModules));
  // A module shows when it's switched on AND the user's role can see it in a business in view.
  const nav = MODULES.filter((m) => (m.core || enabled.has(m.key)) && can(ctx, m.permission)).map((m) => ({
    key: m.key,
    label: m.key === 'crm' ? (ctx.current?.terminology?.contacts ?? m.label) : m.key === 'jobs' ? (ctx.current?.terminology?.jobs ?? m.label) : m.label,
    href: m.href, icon: m.icon, group: m.group,
  }));
  const unread = await readScope(ctx, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)` }).from(notifications)
      .where(and(isNull(notifications.readAt), or(isNull(notifications.userId), eq(notifications.userId, ctx.user.id))));
    return Number(r?.n ?? 0);
  });
  const data: ShellData = {
    user: { name: ctx.user.name, email: ctx.user.email },
    accountName: ctx.account.name,
    businesses: ctx.businesses.map((b) => ({ id: b.id, name: b.name, shortName: b.shortName, color: b.color, enabledModules: b.enabledModules })),
    currentId: ctx.current?.id ?? null,
    nav,
    unread,
    isOwner: ctx.isOwner,
    canAdminister: canAdminister(ctx),
    can: {
      contacts: can(ctx, 'contacts.edit'), leads: can(ctx, 'sales.edit'), deals: can(ctx, 'sales.edit'), tasks: can(ctx, 'tasks.edit'),
      appointments: can(ctx, 'calendar.edit'), quotes: can(ctx, 'quotes.edit'), invoices: can(ctx, 'invoices.edit'),
      payments: can(ctx, 'payments.record'), notes: can(ctx, 'contacts.edit'), jobs: can(ctx, 'jobs.edit'), ai: can(ctx, 'ai.use'),
    },
    tzOffsetMinutes: tzOffsetMinutes(new Date(), ctx.tz),
  };
  return (
    <div className="min-h-dvh">
      <Sidebar data={data} logout={logoutAction} />
      <div className="md:pl-64">
        <TopBar data={data} />
        <main className="mx-auto max-w-6xl px-4 pb-32 pt-5 md:px-8 md:pb-16">{children}</main>
      </div>
      <MobileNav data={data} logout={logoutAction} />
      <QuickAdd businesses={data.businesses} currentId={data.currentId} allowed={data.can} />
      <CommandPalette data={data} />
      {data.can.ai ? <AssistantPanel currentBusiness={ctx.current?.name ?? null} /> : null}
      <Toaster />
    </div>
  );
}
