'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { runCommandAction } from '@/server/actions/shell';
import { toast } from '@/components/toast';

/** Type a task in plain English: "call Steve tomorrow 10am". Dates are understood automatically. */
export function AddTaskInline({ businesses }: { businesses: { id: string; name: string }[] }) {
  const [value, setValue] = useState('');
  const [biz, setBiz] = useState(businesses.length === 1 ? businesses[0].id : '');
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    if (!biz) { toast('Pick a business for this task', 'error'); return; }
    start(async () => {
      const out = await runCommandAction(`add task ${value}`, { subAccountId: biz });
      if (out.kind === 'error') toast(out.message, 'error');
      else { toast(out.kind === 'done' ? out.message : 'Task added'); setValue(''); router.refresh(); ref.current?.focus(); }
    });
  };
  return (
    <form onSubmit={submit} className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Plus className="pointer-events-none absolute left-4 top-4 size-5 text-muted" />
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a task… e.g. call Steve tomorrow 10am"
          className="h-13 w-full rounded-2xl border border-border bg-surface py-3.5 pl-12 pr-4 text-base placeholder:text-muted focus:border-accent focus:outline-none" />
      </div>
      {businesses.length > 1 ? (
        <select value={biz} onChange={(e) => setBiz(e.target.value)} className="h-13 rounded-2xl border border-border bg-surface px-3 text-sm" aria-label="Business">
          <option value="">Business…</option>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      ) : null}
      <button disabled={pending} className="h-13 rounded-2xl bg-accent px-5 text-sm font-medium text-accent-fg disabled:opacity-50">{pending ? 'Adding…' : 'Add'}</button>
    </form>
  );
}
