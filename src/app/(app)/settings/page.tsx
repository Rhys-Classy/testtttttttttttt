import Link from 'next/link';
import { Bell, Building2, Layers, ListPlus, Plug, User, Users } from 'lucide-react';
import { requireContext } from '@/server/context';
import { PageHeader } from '@/components/ui/page';

export const metadata = { title: 'Settings' };

const CARDS = [
  { href: '/settings/business', icon: Building2, title: 'Business details', body: 'Name, ABN, address, GST, invoice numbering, terms, branding' },
  { href: '/settings/modules', icon: Layers, title: 'Modules', body: 'Switch features on or off for this business' },
  { href: '/settings/fields', icon: ListPlus, title: 'Custom fields', body: 'Extra details you track, e.g. kitchen type, timber, service type' },
  { href: '/settings/integrations', icon: Plug, title: 'Integrations', body: 'Stripe, email, SMS, calendars and the AI assistant' },
  { href: '/settings/team', icon: Users, title: 'Team', body: 'Give staff access to only the businesses they work in' },
  { href: '/settings/notifications', icon: Bell, title: 'Notifications', body: 'Choose what deserves your attention' },
  { href: '/settings/businesses', icon: Building2, title: 'Businesses', body: 'Add a new business or archive one' },
  { href: '/settings/account', icon: User, title: 'My account', body: 'Password and sign-in' },
];

export default async function SettingsPage() {
  const ctx = await requireContext();
  return (
    <div>
      <PageHeader title="Settings" subtitle={ctx.current ? `Editing ${ctx.current.name}` : 'Some settings belong to one business — open it first.'} />
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="flex gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-accent">
            <c.icon className="mt-0.5 size-5 shrink-0 text-accent" />
            <div><p className="font-medium">{c.title}</p><p className="mt-0.5 text-sm text-muted">{c.body}</p></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
