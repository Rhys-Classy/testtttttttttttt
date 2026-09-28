import Link from 'next/link';
import { grantAllows } from '@/lib/permissions';
import { requireContext } from '@/server/context';
import { PageHeader } from '@/components/ui/page';
import { SETTINGS_LINKS } from './links';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const cards = SETTINGS_LINKS.filter((l) => l.need === 'any' || ctx.isOwner || (l.need !== 'owner' && ctx.businesses.some((b) => grantAllows(ctx.grants[b.id], l.need as never))));
  return (
    <div>
      <PageHeader title="Settings" subtitle={ctx.current ? `Editing ${ctx.current.name}` : 'Some settings belong to one business — open it first.'} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="flex gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-accent">
            <c.icon className="mt-0.5 size-5 shrink-0 text-accent" />
            <div><p className="font-medium">{c.label}</p><p className="mt-0.5 text-sm text-muted">{c.body}</p></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
