import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/lib/commands/parse';

// Monday 28 Sep 2026, 10:00 in Melbourne (AEST, +10:00)
const now = new Date('2026-09-28T00:00:00Z');
const opts = { now, tzOffsetMinutes: 600 };

describe('command centre parser', () => {
  it('creates invoices with GST handling', () => {
    expect(parseCommand('Create invoice for John for $2,500 plus GST', opts)).toEqual({ intent: 'create_invoice', who: 'John', amountCents: 250_000, gst: 'plus', description: undefined });
    expect(parseCommand('invoice Sarah Mitchell $1,100 inc gst for splashback', opts)).toMatchObject({ intent: 'create_invoice', who: 'Sarah Mitchell', amountCents: 110_000, gst: 'inc', description: 'splashback' });
    expect(parseCommand('new quote for ABC Builders 42k', opts)).toMatchObject({ intent: 'create_quote', who: 'ABC Builders', amountCents: 4_200_000, gst: 'default' });
  });

  it('creates tasks with dates', () => {
    const t = parseCommand('Create task to call Steve tomorrow', opts);
    expect(t).toMatchObject({ intent: 'create_task', title: 'Call Steve', allDay: true, who: 'Steve' });
    if (t.intent !== 'create_task') throw new Error();
    expect(t.due!.startsWith('2026-09-29')).toBe(true);
    const r = parseCommand('remind me to order doors friday at 9am', opts);
    expect(r).toMatchObject({ intent: 'create_task', title: 'Order doors', allDay: false });
    if (r.intent !== 'create_task') throw new Error();
    expect(r.due).toBe('2026-10-01T23:00:00.000Z');
  });

  it('books meetings', () => {
    const b = parseCommand('Book meeting with John Friday at 2pm', opts);
    expect(b).toMatchObject({ intent: 'book_appointment', who: 'John', title: 'Meeting with John', durationMinutes: 60 });
    if (b.intent !== 'book_appointment') throw new Error();
    expect(b.start).toBe('2026-10-02T04:00:00.000Z');
    expect(parseCommand('schedule a call with Chloe tomorrow 10am', opts)).toMatchObject({ intent: 'book_appointment', who: 'Chloe', durationMinutes: 30 });
  });

  it('navigates to lists', () => {
    expect(parseCommand('Show overdue invoices', opts)).toEqual({ intent: 'navigate', href: '/invoices?status=overdue', label: 'Overdue invoices' });
    expect(parseCommand('Show leads from Facebook', opts)).toEqual({ intent: 'navigate', href: '/leads?source=facebook', label: 'Leads from Facebook' });
    expect(parseCommand('Show me everything that needs attention', opts)).toMatchObject({ intent: 'navigate', href: '/' });
    expect(parseCommand('go to calendar', opts)).toMatchObject({ intent: 'navigate', href: '/calendar' });
  });

  it('switches business and searches', () => {
    expect(parseCommand('Open Classy Kitchen Facelifts', opts)).toEqual({ intent: 'switch_business', query: 'Classy Kitchen Facelifts' });
    expect(parseCommand('open all businesses', opts)).toEqual({ intent: 'switch_business', query: 'all' });
    expect(parseCommand('Find Sarah', opts)).toEqual({ intent: 'search', query: 'Sarah' });
    expect(parseCommand('sarah', opts)).toEqual({ intent: 'search', query: 'sarah' });
  });

  it('adds people', () => {
    expect(parseCommand('add lead Noah Jones 0466 321 987 from facebook', opts)).toEqual({ intent: 'create_lead', name: 'Noah Jones', phone: '0466 321 987', email: undefined, source: 'facebook' });
    expect(parseCommand('new contact Mia Chen mia@shop.com', opts)).toMatchObject({ intent: 'create_contact', name: 'Mia Chen', email: 'mia@shop.com' });
  });

  it('hands questions to the assistant', () => {
    expect(parseCommand('What should I do today?', opts)).toMatchObject({ intent: 'ask' });
    expect(parseCommand('Who owes me money', opts)).toMatchObject({ intent: 'ask' });
    expect(parseCommand('How much revenue did Classy Kitchen Facelifts make this month?', opts)).toMatchObject({ intent: 'ask' });
  });
});
