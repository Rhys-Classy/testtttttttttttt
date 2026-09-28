'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, Mail, Pencil, Printer, Receipt, X } from 'lucide-react';
import { acceptQuoteAction, invoiceFromQuoteAction, rejectQuoteAction, sendQuoteAction } from '@/server/actions/finance';
import { toast } from '@/components/toast';
import { Button, buttonClass } from '@/components/ui/button';

export function QuoteActions({ q, link }: { q: { id: string; subAccountId: string; status: string; invoiceId: string | null; jobId: string | null }; link: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined | void>) => start(async () => {
    const r = await fn();
    if (r && !r.ok) toast(r.error ?? 'Error', 'error'); else { toast((r && r.message) || 'Done'); router.refresh(); }
  });
  const open = ['draft', 'sent', 'viewed'].includes(q.status);
  return (
    <div className="flex flex-wrap gap-2">
      {open ? <Button variant="primary" disabled={pending} onClick={() => run(() => sendQuoteAction(q.subAccountId, q.id))}><Mail className="size-4" />{q.status === 'draft' ? 'Send to customer' : 'Resend'}</Button> : null}
      {open ? <Button disabled={pending} onClick={() => { if (confirm('Mark this quote as accepted? This runs the accept steps (job, invoice).')) run(() => acceptQuoteAction(q.subAccountId, q.id)); }}><Check className="size-4" />Mark accepted</Button> : null}
      {open ? <Button variant="ghost" disabled={pending} onClick={() => run(() => rejectQuoteAction(q.subAccountId, q.id))}><X className="size-4" />Declined</Button> : null}
      {q.status === 'accepted' && !q.invoiceId ? <Button disabled={pending} onClick={() => run(() => invoiceFromQuoteAction(q.subAccountId, q.id))}><Receipt className="size-4" />Create invoice</Button> : null}
      {q.invoiceId ? <Link href={`/invoices/${q.invoiceId}`} className={buttonClass('secondary')}><Receipt className="size-4" />View invoice</Link> : null}
      {q.jobId ? <Link href={`/jobs/${q.jobId}`} className={buttonClass('secondary')}>View job</Link> : null}
      <Button onClick={() => { navigator.clipboard.writeText(link); toast('Quote link copied'); }}><Copy className="size-4" />Copy link</Button>
      <a href={link} target="_blank" rel="noreferrer" className={buttonClass('secondary')}><ExternalLink className="size-4" />Customer view</a>
      <a href={`${link}?print=1`} target="_blank" rel="noreferrer" className={buttonClass('ghost')}><Printer className="size-4" />PDF</a>
      {open ? <Link href={`/quotes/${q.id}/edit`} className={buttonClass('ghost')}><Pencil className="size-4" />Edit</Link> : null}
    </div>
  );
}
