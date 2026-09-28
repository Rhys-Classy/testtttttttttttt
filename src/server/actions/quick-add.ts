'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { invoices } from '@/db/schema';
import { parseMoney } from '@/lib/money';
import { zonedTimeToUtc } from '@/lib/dates';
import { inBusiness, requireContext } from '@/server/context';
import { addNote, contactName, createContact, createDeal, createLead, getContact } from '@/server/services/crm';
import { createInvoice, createQuote, recordManualPayment } from '@/server/services/finance';
import { createAppointment, createJob, createTask } from '@/server/services/work';
import { ValidationError } from '@/server/services/_common';
import { attempt, optStr, str, type ActionResult } from './_util';

export type QuickKind = 'contact' | 'lead' | 'deal' | 'task' | 'appointment' | 'quote' | 'invoice' | 'payment' | 'note' | 'job';

/** Local date + optional time (in the business timezone) -> UTC instant. */
function localDateTime(date: string, time: string | null, tz: string, defaultHour = 9): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || `${defaultHour}:00`).split(':').map(Number);
  return zonedTimeToUtc(y, m, d, hh, mm || 0, tz);
}

export async function quickAddAction(kind: QuickKind, fd: FormData): Promise<ActionResult<{ href?: string }>> {
  const ctx = await requireContext();
  return attempt(async () => {
    const subAccountId = str(fd, 'subAccountId') || ctx.current?.id;
    if (!subAccountId) throw new ValidationError('Pick which business this is for.');
    const biz = ctx.businesses.find((b) => b.id === subAccountId);
    const tz = biz?.timezone ?? ctx.tz;
    const contactId = optStr(fd, 'contactId');
    const amount = parseMoney(str(fd, 'amount'));

    const result = await inBusiness(ctx, subAccountId, async (tx, s): Promise<{ href?: string }> => {
      switch (kind) {
        case 'contact': {
          const c = await createContact(tx, s, { name: str(fd, 'name'), email: optStr(fd, 'email'), phone: optStr(fd, 'phone'), companyName: optStr(fd, 'company'), status: (optStr(fd, 'status') as 'lead' | 'customer') ?? 'lead', source: 'manual' });
          return { href: `/contacts/${c.id}` };
        }
        case 'lead': {
          const { contact } = await createLead(tx, s, { name: str(fd, 'name'), email: optStr(fd, 'email'), phone: optStr(fd, 'phone'), source: (optStr(fd, 'source') ?? 'manual') as never, notes: optStr(fd, 'notes'), valueCents: amount ?? 0 });
          return { href: `/contacts/${contact.id}` };
        }
        case 'deal': {
          await createDeal(tx, s, { title: str(fd, 'title') || (contactId ? contactName(await getContact(tx, s, contactId)) : ''), contactId, valueCents: amount ?? 0 });
          return { href: '/pipeline' };
        }
        case 'task': {
          await createTask(tx, s, { title: str(fd, 'title'), dueAt: localDateTime(str(fd, 'date'), optStr(fd, 'time'), tz), allDay: !optStr(fd, 'time'), priority: (optStr(fd, 'priority') ?? 'normal') as never, contactId });
          return {};
        }
        case 'appointment': {
          const start = localDateTime(str(fd, 'date'), optStr(fd, 'time') ?? '09:00', tz);
          if (!start) throw new ValidationError('Pick a date.');
          await createAppointment(tx, s, { title: str(fd, 'title') || (contactId ? `Appointment with ${contactName(await getContact(tx, s, contactId))}` : ''), startsAt: start, durationMinutes: Number(str(fd, 'duration') || 60), contactId, location: optStr(fd, 'location') });
          return { href: '/calendar' };
        }
        case 'quote':
        case 'invoice': {
          if (!contactId) throw new ValidationError('Pick a customer.');
          if (amount === null) throw new ValidationError('Enter an amount.');
          const gst = str(fd, 'gst');
          const line = { description: str(fd, 'description') || (kind === 'quote' ? 'Quoted works' : 'Services'), quantity: 1, unitPriceCents: amount, taxCode: gst === 'none' ? 'GST_FREE' : 'GST' };
          const pricesIncludeTax = gst === 'inc' ? true : gst === 'plus' ? false : undefined;
          if (kind === 'quote') {
            const q = await createQuote(tx, s, { contactId, lines: [line], pricesIncludeTax });
            return { href: `/quotes/${q.id}` };
          }
          const inv = await createInvoice(tx, s, { contactId, lines: [line], pricesIncludeTax });
          return { href: `/invoices/${inv.id}` };
        }
        case 'payment': {
          const number = str(fd, 'invoiceNumber');
          const [inv] = await tx.select().from(invoices).where(and(eq(invoices.subAccountId, s.subAccountId), eq(invoices.number, number)));
          if (!inv) throw new ValidationError(`No invoice ${number} in ${biz?.name}.`);
          await recordManualPayment(tx, s, { invoiceId: inv.id, amountCents: amount ?? inv.totalCents - inv.amountPaidCents, method: str(fd, 'method') || 'bank_transfer', reference: optStr(fd, 'reference') });
          return { href: `/invoices/${inv.id}` };
        }
        case 'note': {
          if (!contactId) throw new ValidationError('Pick who the note is about.');
          await addNote(tx, s, { entityType: 'contact', entityId: contactId, contactId, body: str(fd, 'body') });
          return { href: `/contacts/${contactId}` };
        }
        case 'job': {
          const start = localDateTime(str(fd, 'date'), optStr(fd, 'time') ?? '07:30', tz);
          const j = await createJob(tx, s, { title: str(fd, 'title'), contactId, scheduledStart: start, valueCents: amount ?? 0 });
          return { href: `/jobs/${j.id}` };
        }
      }
    });
    revalidatePath('/', 'layout');
    return result;
  }, `${kind.charAt(0).toUpperCase() + kind.slice(1)} added${biz(ctx, fd) ? ` to ${biz(ctx, fd)}` : ''}`);
}

function biz(ctx: Awaited<ReturnType<typeof requireContext>>, fd: FormData) {
  const id = str(fd, 'subAccountId') || ctx.current?.id;
  return ctx.businesses.find((b) => b.id === id)?.name;
}
