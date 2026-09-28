import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty';

/** Shown when a role doesn't include a module. The database would return nothing anyway. */
export function NoAccess({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <EmptyState icon={<Lock className="size-6" />} title={`Your role doesn’t include ${what}`} body="Ask the account owner if you need it (Settings → Team)." />
    </div>
  );
}
