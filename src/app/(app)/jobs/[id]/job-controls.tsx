'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { jobNotesAction, jobStatusAction, scheduleJobAction } from '@/server/actions/work';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import type { JobStatus } from '@/db/schema';

const STEPS: { key: JobStatus; label: string }[] = [
  { key: 'booked', label: 'Booked' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'in_progress', label: 'In progress' },
  { key: 'waiting', label: 'Waiting' }, { key: 'completed', label: 'Completed' },
];

export function JobStatusStepper({ subAccountId, id, status }: { subAccountId: string; id: string; status: JobStatus }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (s: JobStatus) => start(async () => { const r = await jobStatusAction(subAccountId, id, s); if (!r.ok) toast(r.error, 'error'); else { toast(`Job ${s.replace('_', ' ')}`); router.refresh(); } });
  return (
    <div className="flex flex-wrap gap-2">
      {STEPS.map((s) => (
        <button key={s.key} disabled={pending} onClick={() => set(s.key)}
          className={cn('h-11 rounded-xl border px-4 text-sm font-medium', status === s.key ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface hover:bg-surface-2')}>{s.label}</button>
      ))}
      {status !== 'cancelled' ? <button disabled={pending} onClick={() => { if (confirm('Cancel this job?')) set('cancelled'); }} className="h-11 rounded-xl px-4 text-sm text-muted hover:text-danger">Cancel job</button> : null}
    </div>
  );
}

export function JobSchedule({ subAccountId, id, startDate, startTime, endDate, endTime }: { subAccountId: string; id: string; startDate: string; startTime: string; endDate: string; endTime: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form action={(fd) => start(async () => { const r = await scheduleJobAction(fd); if (!r.ok) toast(r.error, 'error'); else { toast('Scheduled'); router.refresh(); } })} className="space-y-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="subAccountId" value={subAccountId} />
      <div className="grid grid-cols-2 gap-2"><Field label="Start"><Input type="date" name="startDate" required defaultValue={startDate} /></Field><Field label="Time"><Input type="time" name="startTime" defaultValue={startTime || '07:30'} /></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Finish"><Input type="date" name="endDate" defaultValue={endDate} /></Field><Field label="Time"><Input type="time" name="endTime" defaultValue={endTime || '16:00'} /></Field></div>
      <Button type="submit" variant="secondary" size="sm" className="w-full" disabled={pending}>Save dates</Button>
    </form>
  );
}

export function JobNotes({ subAccountId, id, notes }: { subAccountId: string; id: string; notes: string }) {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(async () => { const r = await jobNotesAction(fd); toast(r.ok ? 'Saved' : r.error, r.ok ? 'ok' : 'error'); })}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="subAccountId" value={subAccountId} />
      <Textarea name="notes" defaultValue={notes} rows={5} placeholder="Site notes, measurements, access, colours…" />
      <Button type="submit" size="sm" className="mt-2" disabled={pending}>Save notes</Button>
    </form>
  );
}
