import Link from 'next/link';
import { requireContext } from '@/server/context';

const LINKS = [
  { href: '/settings', label: 'Overview' },
  { href: '/settings/business', label: 'Business details' },
  { href: '/settings/modules', label: 'Modules' },
  { href: '/settings/fields', label: 'Custom fields' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/businesses', label: 'Businesses' },
  { href: '/settings/account', label: 'My account' },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[13rem_1fr]">
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0" aria-label="Settings">
        <p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted md:block">{ctx.current ? ctx.current.name : 'All businesses'}</p>
        {LINKS.map((l) => <Link key={l.href} href={l.href} className="shrink-0 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">{l.label}</Link>)}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
