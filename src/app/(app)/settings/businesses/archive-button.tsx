'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { archiveBusinessAction } from '@/server/actions/settings';
import { toast } from '@/components/toast';

export function ArchiveButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button disabled={pending} className="text-xs text-muted hover:text-danger" onClick={() => {
      if (!confirm(`Archive ${name}? It disappears from the switcher; data is kept.`)) return;
      start(async () => { const r = await archiveBusinessAction(id, true); toast(r.ok ? 'Archived' : r.error, r.ok ? 'ok' : 'error'); router.refresh(); });
    }}>Archive</button>
  );
}
