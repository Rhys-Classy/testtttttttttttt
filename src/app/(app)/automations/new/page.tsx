import { requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { builderContext } from '@/server/queries/automation-ctx';
import { WORKFLOW_TEMPLATES } from '@/lib/automation/templates';
import { PageHeader } from '@/components/ui/page';
import { ModuleOff } from '@/components/module-off';
import { WorkflowBuilder } from '../builder';

export const metadata = { title: 'New automation' };

export default async function NewAutomationPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'automations');
  if (!scope.businesses.length) return <ModuleOff label="Automations" business={ctx.current?.name} />;
  const tpl = WORKFLOW_TEMPLATES.find((t) => t.key === sp1(p.template));
  const ctxBy = await builderContext(ctx, scope.ids);
  return (
    <div>
      <PageHeader title={tpl ? tpl.name : 'New automation'} subtitle={tpl?.description ?? 'Pick a trigger, then add steps.'} />
      <WorkflowBuilder businesses={scope.businesses.map((b) => ({ id: b.id, name: b.name }))} ctxByBusiness={ctxBy}
        initial={{ subAccountId: ctx.current?.id, name: tpl?.name ?? 'New automation', description: tpl?.description, trigger: tpl?.trigger ?? { type: 'lead.created' }, steps: tpl?.steps ?? [], settings: tpl?.settings ?? { stopOnReply: true } }} />
    </div>
  );
}
