import { describe, expect, it } from 'vitest';
import { AU_GST, NO_TAX, calculateDocument, calculateLine, grossUp, isValidAbn } from '@/lib/tax';
import { formatMoney, parseMoney } from '@/lib/money';
import { addDaysKey, dayRange, monthRange, todayKey, tzOffsetMinutes, weekRange, zonedTimeToUtc } from '@/lib/dates';
import { renderTemplate } from '@/lib/template';
import { advanceCursor, evaluateCondition, normalizeCursor, stepAt, triggerMatches } from '@/server/services/automation';
import type { Step } from '@/lib/automation/types';
import { encryptJson, decryptJson } from '@/lib/crypto';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { normalizePhone, splitName } from '@/server/services/crm';
import { deriveInvoiceStatus } from '@/server/services/finance';
import { snoozeUntil } from '@/server/services/work';

const gst = { regime: AU_GST, pricesIncludeTax: false, taxRegistered: true };

describe('GST (tax configuration layer)', () => {
  it('adds 10% GST to exclusive prices', () => {
    const r = calculateLine({ quantity: 1, unitPriceCents: 250_000, taxCode: 'GST' }, gst);
    expect(r).toMatchObject({ lineSubtotalCents: 250_000, lineTaxCents: 25_000, lineTotalCents: 275_000 });
  });

  it('extracts GST (1/11th) from inclusive prices', () => {
    const r = calculateLine({ quantity: 1, unitPriceCents: 110_00, taxCode: 'GST' }, { ...gst, pricesIncludeTax: true });
    expect(r).toMatchObject({ lineSubtotalCents: 100_00, lineTaxCents: 10_00, lineTotalCents: 110_00 });
  });

  it('handles GST-free lines, discounts and fractional quantities', () => {
    const t = calculateDocument([
      { quantity: 6.2, unitPriceCents: 950_00, taxCode: 'GST' },
      { quantity: 16, unitPriceCents: 70_23, taxCode: 'GST_FREE' },
      { quantity: 2, unitPriceCents: 100_00, discountPercent: 10, taxCode: 'GST' },
    ], gst);
    expect(t.lines[0].lineSubtotalCents).toBe(5890_00);
    expect(t.lines[1].lineTaxCents).toBe(0);
    expect(t.lines[2]).toMatchObject({ discountCents: 20_00, lineSubtotalCents: 180_00, lineTaxCents: 18_00 });
    expect(t.subtotalCents).toBe(5890_00 + 1123_68 + 180_00);
    expect(t.taxCents).toBe(589_00 + 18_00);
    expect(t.totalCents).toBe(t.subtotalCents + t.taxCents);
    expect(t.taxByCode).toEqual({ GST: 607_00, GST_FREE: 0 });
  });

  it('charges no GST when the business is not registered', () => {
    const r = calculateLine({ quantity: 1, unitPriceCents: 100_00, taxCode: 'GST' }, { ...gst, taxRegistered: false });
    expect(r.lineTaxCents).toBe(0);
    expect(AU_GST.documentTitle('invoice', false)).toBe('Invoice');
    expect(AU_GST.documentTitle('invoice', true)).toBe('Tax Invoice');
  });

  it('works with other regimes', () => {
    expect(calculateLine({ quantity: 1, unitPriceCents: 100_00, taxCode: 'NONE' }, { regime: NO_TAX, pricesIncludeTax: false, taxRegistered: true }).lineTaxCents).toBe(0);
  });

  it('validates ABNs and warns on tax invoice requirements', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('51 824 753 557')).toBe(false);
    const w = AU_GST.documentWarnings!({ kind: 'invoice', totalCents: 150_000, taxRegistered: true, businessId: null, buyerName: null });
    expect(w.join(' ')).toMatch(/ABN/);
    expect(w.join(' ')).toMatch(/\$1,000/);
  });

  it('grosses up "plus GST" amounts', () => {
    expect(grossUp(250_000, 1000)).toBe(275_000);
  });
});

describe('money', () => {
  it('parses what people type', () => {
    expect(parseMoney('$2,500')).toBe(250_000);
    expect(parseMoney('2.5k')).toBe(250_000);
    expect(parseMoney('99.95')).toBe(9_995);
    expect(parseMoney('abc')).toBeNull();
  });
  it('formats AUD', () => {
    expect(formatMoney(275_000)).toBe('$2,750.00');
  });
});

describe('dates (Australia/Melbourne)', () => {
  const tz = 'Australia/Melbourne';
  it('knows AEST vs AEDT offsets', () => {
    expect(tzOffsetMinutes(new Date('2026-07-01T00:00:00Z'), tz)).toBe(600);
    expect(tzOffsetMinutes(new Date('2026-01-01T00:00:00Z'), tz)).toBe(660);
  });
  it('builds local day and month ranges', () => {
    const d = dayRange('2026-07-15', tz);
    expect(d.start.toISOString()).toBe('2026-07-14T14:00:00.000Z');
    expect(d.end.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    const m = monthRange('2026-01-20', tz);
    expect(m.start.toISOString()).toBe('2025-12-31T13:00:00.000Z');
  });
  it('handles DST changeover days', () => {
    // DST starts 2026-10-04 in Victoria: that day is 23 hours long.
    const d = dayRange('2026-10-04', tz);
    expect((d.end.getTime() - d.start.getTime()) / 3_600_000).toBe(23);
  });
  it('knows today in the business timezone, not UTC', () => {
    expect(todayKey(tz, new Date('2026-03-01T15:30:00Z'))).toBe('2026-03-02');
    expect(addDaysKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(weekRange('2026-09-30', tz).startKey).toBe('2026-09-28');
    expect(zonedTimeToUtc(2026, 9, 28, 9, 0, tz).toISOString()).toBe('2026-09-27T23:00:00.000Z');
  });
  it('snoozes to 9am tomorrow / next Monday local time', () => {
    const now = new Date('2026-09-30T05:00:00Z'); // Wed 3pm AEST
    expect(snoozeUntil('tomorrow', tz, now).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    // Next Monday (5 Oct) is after DST starts -> 9am AEDT = 22:00Z
    expect(snoozeUntil('next_week', tz, now).toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(snoozeUntil('1h', tz, now).getTime() - now.getTime()).toBe(3_600_000);
  });
});

describe('templates', () => {
  it('renders variables with fallbacks and ignores unknowns', () => {
    expect(renderTemplate('Hi {{contact.first_name|there}}, from {{business.name}} {{nope.x}}', { contact: { first_name: '' }, business: { name: 'CKF' } }))
      .toBe('Hi there, from CKF ');
  });
});

describe('automation engine internals', () => {
  const steps: Step[] = [
    { id: 'a', type: 'wait', config: { amount: 1, unit: 'days' } },
    { id: 'b', type: 'condition', config: { match: 'all', conditions: [] }, yes: [{ id: 'c', type: 'add_tag', config: { tag: 'x' } }], no: [] },
    { id: 'd', type: 'notify', config: { title: 'done' } },
  ];
  it('walks into and out of branches', () => {
    expect(stepAt(steps, [1, 'yes', 0])?.id).toBe('c');
    expect(advanceCursor(steps, [1, 'yes', 0])).toEqual([2]);
    expect(normalizeCursor(steps, [1, 'no', 0])).toEqual([2]);
    expect(advanceCursor(steps, [2])).toBeNull();
  });
  it('evaluates conditions', () => {
    expect(evaluateCondition(6000, { field: 'invoice.total', op: 'gt', value: 5000 })).toBe(true);
    expect(evaluateCondition(['VIP', 'x'], { field: 'contact.tags', op: 'has_tag', value: 'vip' })).toBe(true);
    expect(evaluateCondition('google', { field: 'contact.source', op: 'eq', value: 'Google' })).toBe(true);
    expect(evaluateCondition(null, { field: 'contact.email', op: 'is_set' })).toBe(false);
  });
  it('matches triggers with filters', () => {
    expect(triggerMatches({ type: 'lead.created', config: { source: 'facebook' } }, { type: 'lead.created', payload: { source: 'facebook' } })).toBe(true);
    expect(triggerMatches({ type: 'lead.created', config: { source: 'facebook' } }, { type: 'lead.created', payload: { source: 'google' } })).toBe(false);
    expect(triggerMatches({ type: 'tag.added', config: { tag: 'VIP' } }, { type: 'tag.added', payload: { tag: 'vip' } })).toBe(true);
    expect(triggerMatches({ type: 'invoice.paid' }, { type: 'invoice.overdue', payload: {} })).toBe(false);
  });
});

describe('security helpers', () => {
  it('encrypts and decrypts integration secrets', () => {
    const blob = encryptJson({ secretKey: 'sk_live_123' });
    expect(blob).not.toContain('sk_live_123');
    expect(decryptJson<{ secretKey: string }>(blob)?.secretKey).toBe('sk_live_123');
    const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptJson(tampered)).toThrow();
  });
  it('hashes passwords with scrypt', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('contacts + invoices helpers', () => {
  it('normalises Australian phone numbers', () => {
    expect(normalizePhone('0412 345 678')).toBe('+61412345678');
    expect(normalizePhone('+61 412 345 678')).toBe('+61412345678');
    expect(splitName('Mary Anne Smith')).toEqual({ firstName: 'Mary', lastName: 'Anne Smith' });
  });
  it('derives invoice status', () => {
    const base = { status: 'sent' as const, totalCents: 1000, amountPaidCents: 0, dueDate: '2026-09-30', viewedAt: null, sentAt: new Date() };
    expect(deriveInvoiceStatus(base, '2026-09-28')).toBe('sent');
    expect(deriveInvoiceStatus(base, '2026-10-01')).toBe('overdue');
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 500 }, '2026-09-28')).toBe('partially_paid');
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 1000 }, '2026-10-05')).toBe('paid');
    expect(deriveInvoiceStatus({ ...base, status: 'draft' }, '2026-10-05')).toBe('draft');
  });
});
