import { requireContext } from '@/server/context';
import { moduleScope } from '@/server/page-helpers';
import { formBuilderContext } from '@/server/queries/form-ctx';
import { DEFAULT_FORM_FIELDS } from '@/server/services/marketing';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/ui/page';
import { ModuleOff } from '@/components/module-off';
import { FormBuilder } from '../form-builder';

export const metadata = { title: 'New form' };

export default async function NewFormPage() {
  const ctx = await requireContext();
  const scope = moduleScope(ctx, 'forms');
  if (!scope.businesses.length) return <ModuleOff label="Forms" business={ctx.current?.name} />;
  const fc = await formBuilderContext(ctx, scope.ids);
  return (
    <div>
      <PageHeader title="New form" />
      <FormBuilder appUrl={env().APP_URL} businesses={scope.businesses.map((b) => ({ id: b.id, name: b.name }))} pipelines={fc.pipelinesBy} customFields={fc.fieldsBy}
        initial={{ subAccountId: ctx.current?.id, name: 'Enquiry form', fields: DEFAULT_FORM_FIELDS, settings: { createLead: true, notify: true, leadSource: 'website', thankYouMessage: "Thanks! We'll be in touch shortly." }, status: 'published' }} />
    </div>
  );
}
