'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, LogOut, Settings } from 'lucide-react';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';
import { BusinessSwitcher } from './business-switcher';
import type { ShellData } from './types';

const GROUP_ORDER = ['daily', 'customers', 'sales', 'money', 'work', 'marketing', 'insights'];
const GROUP_LABELS: Record<string, string> = { daily: '', customers: 'Customers', sales: 'Sales', money: 'Money', work: 'Work', marketing: 'Marketing', insights: 'Insights' };

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ data, logout }: { data: ShellData; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const groups = GROUP_ORDER.map((g) => ({ g, items: data.nav.filter((n) => n.group === g) })).filter((x) => x.items.length);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface md:flex">
      <div className="space-y-3 p-3">
        <p className="truncate px-1 pt-1 text-xs font-medium uppercase tracking-wider text-muted">{data.accountName}</p>
        <BusinessSwitcher businesses={data.businesses} currentId={data.currentId} />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
        <NavLink href="/" label="Home" active={pathname === '/'} icon={<House className="size-5" />} />
        {groups.map(({ g, items }) => (
          <div key={g} className="mt-2.5">
            {GROUP_LABELS[g] ? <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{GROUP_LABELS[g]}</p> : null}
            {items.map((n) => <NavLink key={n.key} href={n.href} label={n.label} active={isActive(pathname, n.href)} icon={<Icon name={n.icon} />} />)}
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <NavLink href="/settings" label="Settings" active={isActive(pathname, '/settings')} icon={<Settings className="size-5" />} />
        <div className="mt-2 flex items-center gap-2 px-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{data.user.name}</p>
            <p className="truncate text-xs text-muted">{data.user.email}</p>
          </div>
          <form action={logout}>
            <button className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Log out" title="Log out"><LogOut className="size-4" /></button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={cn('flex h-9 items-center gap-3 rounded-xl px-3 text-sm transition-colors', active ? 'bg-accent-soft font-semibold text-accent' : 'text-text hover:bg-surface-2')}>
      <span className={active ? 'text-accent' : 'text-muted'}>{icon}</span>
      {label}
    </Link>
  );
}
