import { requireContext } from '@/server/context';
import { MODULES } from '@/lib/modules/registry';
import { PageHeader } from '@/components/ui/page';
import { PickBusiness } from '@/components/pick-business';
import { ModulesForm } from './modules-form';

export const metadata = { title: 'Modules' };

export default async function ModulesPage() {
  const ctx = await requireContext();
  if (!ctx.current) return <PickBusiness ctx={ctx} what="Modules" />;
  return (
    <div>
      <PageHeader title="Modules" subtitle={`Only switch on what ${ctx.current.name} actually uses. Less on screen = less to think about.`} />
      <ModulesForm subAccountId={ctx.current.id} enabled={ctx.current.enabledModules} modules={MODULES.map((m) => ({ key: m.key, label: m.label, description: m.description, icon: m.icon, core: m.core }))} />
    </div>
  );
}
