import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { campaigns } from '@/db/schema';
import { isUuid } from '@/db/context';
import { businessById, readScope, requireContext } from '@/server/context';
import { campaignOptions } from '@/server/queries/campaign-ctx';
import { PageHeader, Stat } from '@/components/ui/page';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { CampaignEditor } from '../campaign-editor';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const [c] = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => tx.select().from(campaigns).where(eq(campaigns.id, id)));
  if (!c) notFound();
  const biz = businessById(ctx, c.subAccountId)!;
  const optsBy = await campaignOptions(ctx, [biz.id]);
  const locked = ['sending', 'sent'].includes(c.status);
  return (
    <div className="space-y-5">
      <PageHeader title={c.name} subtitle={<span className="flex items-center gap-2"><BusinessBadge business={biz} full /><StatusBadge status={c.status} /></span>} />
      {c.status === 'sent' ? (
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Recipients" value={c.stats.recipients} /><Stat label="Sent" value={c.stats.sent} /><Stat label="Failed" value={c.stats.failed} tone={c.stats.failed ? 'danger' : undefined} /><Stat label="Opted out" value={c.stats.optedOut} />
        </Card>
      ) : null}
      <CampaignEditor locked={locked} businesses={[{ id: biz.id, name: biz.name }]} optsBy={optsBy}
        initial={{ id: c.id, subAccountId: biz.id, name: c.name, channel: c.channel, subject: c.subject ?? '', body: c.body, segment: c.segment }} />
    </div>
  );
}
