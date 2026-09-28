'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Phone, X } from 'lucide-react';
import { convertLeadAction, leadStatusAction } from '@/server/actions/crm';
import { toast } from '@/components/toast';

export function LeadActions({ subAccountId, leadId, status, phone }: { subAccountId: string; leadId: string; status: string; phone: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? 'Error', 'error'); else { toast(r.message ?? 'Updated'); router.refresh(); }
  });
  const btn = 'flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50';
  return (
    <div className="flex flex-wrap gap-1.5">
      {phone ? <a href={`tel:${phone}`} className={btn}><Phone className="size-3.5" />Call</a> : null}
      {status === 'new' ? <button disabled={pending} className={btn} onClick={() => run(() => leadStatusAction(subAccountId, leadId, 'contacted'))}><Check className="size-3.5" />Contacted</button> : null}
      {status === 'contacted' ? <button disabled={pending} className={btn} onClick={() => run(() => leadStatusAction(subAccountId, leadId, 'qualified'))}><Check className="size-3.5" />Qualified</button> : null}
      {status !== 'converted' ? <button disabled={pending} className={`${btn} border-accent text-accent`} onClick={() => run(() => convertLeadAction(subAccountId, leadId))}><ArrowRight className="size-3.5" />To pipeline</button> : null}
      {status !== 'unqualified' && status !== 'converted' ? <button disabled={pending} className={btn} onClick={() => run(() => leadStatusAction(subAccountId, leadId, 'unqualified'))} aria-label="Not a fit"><X className="size-3.5" /></button> : null}
    </div>
  );
}
