import { desc, sql } from 'drizzle-orm';
import { Megaphone } from 'lucide-react';
import { campaigns } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDateTime } from '@/lib/dates';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';

export const metadata = { title: 'Campaigns' };

export default async function CampaignsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'campaigns', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Campaigns" business={ctx.current?.name} />;
  const rows = await readScope(ctx, (tx) => tx.select().from(campaigns).where(sql`${campaigns.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(campaigns.updatedAt)));
  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Email and SMS to a segment of your contacts. Opt-outs are respected automatically." actions={<LinkButton href="/campaigns/new" variant="primary">New campaign</LinkButton>} />
      {rows.length ? (
        <List>{rows.map((c) => (
          <ListRow key={c.id} href={`/campaigns/${c.id}`} icon={<Megaphone className="size-5" />} title={c.name}
            meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, c.subAccountId)} /> : null}<StatusBadge status={c.status} /><span>{c.channel.toUpperCase()}</span>{c.sentAt ? <span>Sent {formatDateTime(c.sentAt, ctx.tz)}</span> : c.scheduledAt ? <span>Scheduled {formatDateTime(c.scheduledAt, ctx.tz)}</span> : null}</>}
            right={c.status === 'sent' ? c.stats.sent : undefined} rightSub={c.status === 'sent' ? 'sent' : undefined} />
        ))}</List>
      ) : <EmptyState title="No campaigns yet" body="Send a promo to VIPs, a win-back to past customers, or news to everyone." />}
    </div>
  );
}
