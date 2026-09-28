'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addStaffAction, staffActiveAction } from '@/server/actions/work';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';

export function AddStaff({ businesses }: { businesses: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form action={(fd) => start(async () => { const r = await addStaffAction(fd); if (!r.ok) toast(r.error, 'error'); else { toast('Added'); router.refresh(); } })}
      className="mb-4 grid gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
      <Input name="name" required placeholder="Name" />
      <Input name="role" placeholder="Role (e.g. Support worker)" />
      <Input name="phone" placeholder="Mobile" />
      {businesses.length > 1 ? <Select name="subAccountId" required defaultValue=""><option value="" disabled>Business…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select> : <input type="hidden" name="subAccountId" value={businesses[0]?.id} />}
      <Button type="submit" variant="primary" disabled={pending}>Add</Button>
    </form>
  );
}

export function StaffToggle({ subAccountId, id, active }: { subAccountId: string; id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await staffActiveAction(subAccountId, id, !active); router.refresh(); })}>{active ? 'Deactivate' : 'Reactivate'}</Button>;
}
