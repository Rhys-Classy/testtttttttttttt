'use client';

import { Plus } from 'lucide-react';
import { openQuickAdd } from '@/components/shell/quick-add';
import { buttonClass } from '@/components/ui/button';
import type { QuickKind } from '@/server/actions/quick-add';

export function AddButton({ kind, label }: { kind: QuickKind; label: string }) {
  return <button onClick={() => openQuickAdd(kind)} className={buttonClass('primary', 'md')}><Plus className="size-4" />{label}</button>;
}
