import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty';

export function ModuleOff({ label, business }: { label: string; business?: string | null }) {
  return (
    <EmptyState
      title={`${label} is switched off${business ? ` for ${business}` : ''}`}
      body="Turn it on in Settings → Modules if this business needs it."
      action={<LinkButton href="/settings/modules" variant="primary">Open settings</LinkButton>}
    />
  );
}
