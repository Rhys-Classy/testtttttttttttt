import { Lock } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty';

export function ModuleOff({ label, business, noAccess }: { label: string; business?: string | null; noAccess?: boolean }) {
  if (noAccess) {
    return (
      <EmptyState icon={<Lock className="size-6" />} title={`Your role doesn’t include ${label}${business ? ` in ${business}` : ''}`}
        body="Ask the account owner if you need it (Settings → Team)." />
    );
  }
  return (
    <EmptyState
      title={`${label} is switched off${business ? ` for ${business}` : ''}`}
      body="Turn it on in Settings → Modules if this business needs it."
      action={<LinkButton href="/settings/modules" variant="primary">Open settings</LinkButton>}
    />
  );
}
