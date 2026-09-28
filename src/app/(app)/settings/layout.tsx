import Link from 'next/link';
import { grantAllows } from '@/lib/permissions';
import { requireContext } from '@/server/context';
import { SETTINGS_LINKS } from './links';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const links = SETTINGS_LINKS.filter((l) => l.need === 'any' || ctx.isOwner || (l.need !== 'owner' && ctx.businesses.some((b) => grantAllows(ctx.grants[b.id], l.need as never))));
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[13rem_1fr]">
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0" aria-label="Settings">
        <p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted md:block">{ctx.current ? ctx.current.name : 'All businesses'}</p>
        <Link href="/settings" className="shrink-0 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">Overview</Link>
        {links.map((l) => <Link key={l.href} href={l.href} className="shrink-0 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">{l.label}</Link>)}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
