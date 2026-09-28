import type { TaxRegime } from './types';

export type LineInput = {
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  taxCode: string;
};

export type LineResult = {
  taxCode: string;
  taxRateBps: number;
  /** Before discount, in the document's entry mode. */
  grossCents: number;
  discountCents: number;
  /** Excluding tax. */
  lineSubtotalCents: number;
  lineTaxCents: number;
  /** Including tax. */
  lineTotalCents: number;
};

export type DocumentTotals = {
  lines: LineResult[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Tax per code, for the tax summary on a tax invoice. */
  taxByCode: Record<string, number>;
};

export type CalcOptions = {
  regime: TaxRegime;
  pricesIncludeTax: boolean;
  taxRegistered: boolean;
};

/** Round half away from zero (what people expect on invoices). */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

export function calculateLine(line: LineInput, opts: CalcOptions): LineResult {
  const code = opts.regime.codes.find((c) => c.code === line.taxCode) ?? opts.regime.codes.find((c) => c.code === opts.regime.defaultCode)!;
  const rate = opts.taxRegistered ? code.rateBps : 0;
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const gross = round(qty * line.unitPriceCents);
  const pct = Math.min(Math.max(line.discountPercent ?? 0, 0), 100);
  const discount = round((gross * pct) / 100);
  const net = gross - discount;

  let subtotal: number;
  let tax: number;
  let total: number;
  if (opts.pricesIncludeTax) {
    total = net;
    tax = round((net * rate) / (10_000 + rate));
    subtotal = total - tax;
  } else {
    subtotal = net;
    tax = round((net * rate) / 10_000);
    total = subtotal + tax;
  }
  return {
    taxCode: code.code,
    taxRateBps: rate,
    grossCents: gross,
    discountCents: discount,
    lineSubtotalCents: subtotal,
    lineTaxCents: tax,
    lineTotalCents: total,
  };
}

export function calculateDocument(lines: LineInput[], opts: CalcOptions): DocumentTotals {
  const results = lines.map((l) => calculateLine(l, opts));
  const taxByCode: Record<string, number> = {};
  for (const r of results) taxByCode[r.taxCode] = (taxByCode[r.taxCode] ?? 0) + r.lineTaxCents;
  return {
    lines: results,
    subtotalCents: results.reduce((s, r) => s + r.lineSubtotalCents, 0),
    discountCents: results.reduce((s, r) => s + r.discountCents, 0),
    taxCents: results.reduce((s, r) => s + r.lineTaxCents, 0),
    totalCents: results.reduce((s, r) => s + r.lineTotalCents, 0),
    taxByCode,
  };
}

/** "$2,500 plus GST" -> the GST-inclusive total, "$2,750 inc GST" -> itself. */
export function grossUp(amountCents: number, rateBps: number): number {
  return round(amountCents + (amountCents * rateBps) / 10_000);
}
