'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CalendarDays, CheckCircle2, House, Inbox, LogOut, Menu, Settings, Users, X } from 'lucide-react';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';
import { isActive } from './sidebar';
import { BusinessSwitcher } from './business-switcher';
import type { ShellData } from './types';

const PRIMARY = [
  { href: '/', label: 'Home', icon: House },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/tasks', label: 'Tasks', icon: CheckCircle2 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/contacts', label: 'Contacts', icon: Users },
];

/** Thumb-reachable bottom bar: Home, Inbox, Tasks, Calendar, Contacts, More. */
export function MobileNav({ data, logout }: { data: ShellData; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  // Keep the bar to what the role can open (Home is always there).
  const navHrefs = new Set(data.nav.map((n) => n.href));
  const primary = PRIMARY.filter((p) => p.href === '/' || navHrefs.has(p.href));
  const primaryHrefs = new Set(primary.map((p) => p.href));
  const rest = data.nav.filter((n) => !primaryHrefs.has(n.href));
  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {primary.map(({ href, label, icon: I }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px]', active ? 'font-semibold text-accent' : 'text-muted')}>
                <I className="size-6" aria-hidden />
                {label}
              </Link>
            );
          })}
          <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] text-muted">
            <Menu className="size-6" aria-hidden />
            More
          </button>
        </div>
      </nav>
      {more ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-backdrop" aria-label="Close" onClick={() => setMore(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold">More</p>
              <button onClick={() => setMore(false)} className="rounded-lg p-2 text-muted" aria-label="Close"><X className="size-5" /></button>
            </div>
            <BusinessSwitcher businesses={data.businesses} currentId={data.currentId} />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {rest.map((n) => (
                <Link key={n.key} href={n.href} onClick={() => setMore(false)} className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2 p-3 text-center text-xs font-medium">
                  <Icon name={n.icon} className="size-6 text-accent" />
                  {n.label}
                </Link>
              ))}
              <Link href="/settings" onClick={() => setMore(false)} className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2 p-3 text-center text-xs font-medium">
                <Settings className="size-6 text-accent" />Settings
              </Link>
            </div>
            <form action={logout} className="mt-4">
              <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm text-muted"><LogOut className="size-4" />Log out</button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
