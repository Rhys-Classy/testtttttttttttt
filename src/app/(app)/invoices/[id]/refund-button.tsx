'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refundPaymentAction } from '@/server/actions/finance';
import { toast } from '@/components/toast';

export function RefundButton({ subAccountId, paymentId, label }: { subAccountId: string; paymentId: string; label: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button disabled={pending} className="text-xs text-muted hover:text-danger" onClick={() => {
      if (!confirm(`Refund ${label}? This cannot be undone.`)) return;
      start(async () => { const r = await refundPaymentAction(subAccountId, paymentId); toast(r.ok ? 'Refund issued' : r.error, r.ok ? 'ok' : 'error'); router.refresh(); });
    }}>Refund</button>
  );
}
