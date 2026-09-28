'use client';

import { useTransition } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { setThemeAction } from '@/server/actions/preferences';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; hint: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes (default)', icon: Moon },
  { value: 'light', label: 'Light', hint: 'Bright surfaces', icon: Sun },
  { value: 'system', label: 'Match device', hint: 'Follows your phone/computer', icon: Monitor },
];

export function ThemePicker({ current }: { current: Theme }) {
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={current === o.value} disabled={pending}
          onClick={() => start(() => setThemeAction(o.value))}
          className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
            current === o.value ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}>
          <o.icon className={cn('size-5 shrink-0', current === o.value ? 'text-accent' : 'text-muted')} />
          <span><span className="block text-sm font-medium">{o.label}</span><span className="block text-xs text-muted">{o.hint}</span></span>
        </button>
      ))}
    </div>
  );
}
