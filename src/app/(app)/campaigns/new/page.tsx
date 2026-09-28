import { requireContext } from '@/server/context';
import { moduleScope } from '@/server/page-helpers';
import { campaignOptions } from '@/server/queries/campaign-ctx';
import { PageHeader } from '@/components/ui/page';
import { ModuleOff } from '@/components/module-off';
import { CampaignEditor } from '../campaign-editor';

export const metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  const ctx = await requireContext();
  const scope = moduleScope(ctx, 'campaigns');
  if (!scope.businesses.length) return <ModuleOff label="Campaigns" business={ctx.current?.name} />;
  const optsBy = await campaignOptions(ctx, scope.ids);
  return (
    <div>
      <PageHeader title="New campaign" />
      <CampaignEditor businesses={scope.businesses.map((b) => ({ id: b.id, name: b.name }))} optsBy={optsBy}
        initial={{ subAccountId: ctx.current?.id, name: 'New campaign', channel: 'email', subject: '', body: 'Hi {{contact.first_name|there}},\n\n', segment: { match: 'all', rules: [{ field: 'status', op: 'eq', value: 'customer' }] } }} />
    </div>
  );
}
