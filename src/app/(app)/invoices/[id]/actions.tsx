'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Bell, Copy, CreditCard, ExternalLink, Mail, MessageSquare, Pencil, Printer, X } from 'lucide-react';
import { cancelInvoiceAction, recordPaymentAction, sendInvoiceAction, sendReminderAction } from '@/server/actions/finance';
import { toast } from '@/components/toast';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';

export function InvoiceActions({ inv, link, hasEmail, hasPhone, balance, canEdit, canRecord }: {
  inv: { id: string; subAccountId: string; status: string; number: string; amountPaidCents: number };
  link: string; hasEmail: boolean; hasPhone: boolean; balance: string;
  /** From the user's role; the server checks again. */
  canEdit: boolean; canRecord: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? 'Error', 'error'); else { toast(r.message ?? 'Done'); router.refresh(); }
  });
  const open = !['paid', 'cancelled'].includes(inv.status);
  return (
    <div className="flex flex-wrap gap-2">
      {inv.status === 'draft' && canEdit ? (
        <>
          {hasEmail ? <Button variant="primary" disabled={pending} onClick={() => run(() => sendInvoiceAction(inv.subAccountId, inv.id, 'email'))}><Mail className="size-4" />Send by email</Button> : null}
          {hasPhone ? <Button variant={hasEmail ? 'secondary' : 'primary'} disabled={pending} onClick={() => run(() => sendInvoiceAction(inv.subAccountId, inv.id, 'sms'))}><MessageSquare className="size-4" />Send by SMS</Button> : null}
          {!hasEmail && !hasPhone ? <Button variant="primary" disabled={pending} onClick={() => run(() => sendInvoiceAction(inv.subAccountId, inv.id))}>Mark as sent</Button> : null}
        </>
      ) : null}
      {open && inv.status !== 'draft' && canRecord ? <Button variant="primary" onClick={() => { setErr(null); dlg.current?.showModal(); }}><CreditCard className="size-4" />Record payment</Button> : null}
      {inv.status === 'overdue' && canEdit ? <Button disabled={pending} onClick={() => run(() => sendReminderAction(inv.subAccountId, inv.id))}><Bell className="size-4" />Send reminder</Button> : null}
      {open && inv.status !== 'draft' && canEdit ? <Button disabled={pending} onClick={() => run(() => sendInvoiceAction(inv.subAccountId, inv.id))}><Mail className="size-4" />Resend</Button> : null}
      <Button onClick={() => { navigator.clipboard.writeText(link); toast('Payment link copied'); }}><Copy className="size-4" />Copy link</Button>
      <a href={link} target="_blank" rel="noreferrer" className={buttonClass('secondary')}><ExternalLink className="size-4" />Customer view</a>
      <a href={`${link}?print=1`} target="_blank" rel="noreferrer" className={buttonClass('ghost')}><Printer className="size-4" />PDF</a>
      {!inv.amountPaidCents && open && canEdit ? <Link href={`/invoices/${inv.id}/edit`} className={buttonClass('ghost')}><Pencil className="size-4" />Edit</Link> : null}
      {!inv.amountPaidCents && open && canEdit ? <Button variant="ghost" disabled={pending} onClick={() => { if (confirm(`Cancel ${inv.number}?`)) run(() => cancelInvoiceAction(inv.subAccountId, inv.id)); }}><Ban className="size-4" />Cancel</Button> : null}

      <dialog ref={dlg} className="m-auto w-[min(26rem,calc(100vw-1.5rem))] rounded-3xl border border-border bg-surface p-0 text-text">
        <form action={(fd) => start(async () => {
          const r = await recordPaymentAction(fd);
          if (!r.ok) { setErr(r.error); return; }
          dlg.current?.close(); toast('Payment recorded'); router.refresh();
        })} className="space-y-4 p-5">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Record payment</h2><button type="button" onClick={() => dlg.current?.close()} className="text-muted"><X className="size-5" /></button></div>
          {err ? <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p> : null}
          <input type="hidden" name="invoiceId" value={inv.id} />
          <input type="hidden" name="subAccountId" value={inv.subAccountId} />
          <Field label="Amount" hint={`Balance ${balance}. Leave blank to pay in full.`}><Input name="amount" inputMode="decimal" placeholder={balance} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method"><Select name="method" defaultValue="bank_transfer"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></Select></Field>
            <Field label="Date"><Input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
          </div>
          <Field label="Reference"><Input name="reference" /></Field>
          <Button type="submit" variant="primary" className="w-full" disabled={pending}>Save payment</Button>
        </form>
      </dialog>
    </div>
  );
}
