'use client';

import { CalendarPlus, CheckSquare, FilePlus, FileText } from 'lucide-react';
import { openQuickAdd, type PresetContact } from '@/components/shell/quick-add';

export function ContactQuickButtons({ contact }: { contact: PresetContact }) {
  const cls = 'flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-2';
  return (
    <>
      <button className={cls} onClick={() => openQuickAdd('task', contact)}><CheckSquare className="size-4" />Task</button>
      <button className={cls} onClick={() => openQuickAdd('appointment', contact)}><CalendarPlus className="size-4" />Book</button>
      <button className={cls} onClick={() => openQuickAdd('quote', contact)}><FileText className="size-4" />Quote</button>
      <button className={cls} onClick={() => openQuickAdd('invoice', contact)}><FilePlus className="size-4" />Invoice</button>
    </>
  );
}
