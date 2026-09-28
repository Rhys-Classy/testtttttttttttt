'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveModulesAction } from '@/server/actions/settings';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';

export function ModulesForm({ subAccountId, modules, enabled }: { subAccountId: string; modules: { key: string; label: string; description: string; icon: string; core?: boolean }[]; enabled: string[] }) {
  const [on, setOn] = useState(new Set(enabled));
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {modules.map((m) => {
          const active = m.core || on.has(m.key);
          return (
            <button key={m.key} type="button" disabled={m.core} onClick={() => setOn((s) => { const n = new Set(s); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); return n; })}
              className={cn('flex items-start gap-3 rounded-2xl border p-4 text-left', active ? 'border-accent bg-accent-soft/50' : 'border-border bg-surface', m.core && 'opacity-70')}>
              <Icon name={m.icon} className={cn('mt-0.5 size-5', active ? 'text-accent' : 'text-muted')} />
              <div className="flex-1"><p className="font-medium">{m.label}{m.core ? <span className="ml-2 text-xs text-muted">always on</span> : null}</p><p className="text-sm text-muted">{m.description}</p></div>
              <span className={cn('mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors', active ? 'bg-accent' : 'bg-border')}><span className={cn('block size-4 rounded-full bg-white transition-transform', active && 'translate-x-4')} /></span>
            </button>
          );
        })}
      </div>
      <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await saveModulesAction(subAccountId, [...on]); if (!r.ok) toast(r.error, 'error'); else { toast('Modules updated'); router.refresh(); } })}>Save modules</Button>
    </div>
  );
}
