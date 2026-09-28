import { requireContext } from '@/server/context';
import { moduleScope } from '@/server/page-helpers';
import { formsByBusiness } from '@/server/queries/page-ctx';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/ui/page';
import { ModuleOff } from '@/components/module-off';
import { PageBuilder } from '../page-builder';

export const metadata = { title: 'New page' };

export default async function NewLandingPage() {
  const ctx = await requireContext();
  const scope = moduleScope(ctx, 'landing_pages');
  if (!scope.businesses.length) return <ModuleOff label="Landing pages" business={ctx.current?.name} />;
  const fb = await formsByBusiness(ctx, scope.ids);
  const firstForm = ctx.current ? fb[ctx.current.id]?.[0] : undefined;
  return (
    <div>
      <PageHeader title="New landing page" />
      <PageBuilder appUrl={env().APP_URL} businesses={scope.businesses.map((b) => ({ id: b.id, name: b.name }))} formsBy={fb}
        initial={{ subAccountId: ctx.current?.id, name: 'New page', title: ctx.current?.name ?? 'Welcome', published: false, style: { accent: ctx.current?.color ?? '#4f46e5' },
          sections: [
            { id: 'h', type: 'hero', heading: 'Transform your space without the full renovation price', subheading: 'Free measure and quote. Most jobs done in days, not weeks.', buttonLabel: 'Get my free quote', buttonHref: '#form' },
            { id: 't', type: 'testimonials', items: [{ quote: 'Looks like a brand new kitchen for a fraction of the cost.', name: 'Local customer' }] },
            ...(firstForm ? [{ id: 'f', type: 'form' as const, formId: firstForm.id }] : []),
          ] }} />
    </div>
  );
}
