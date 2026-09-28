import type { TaxRegime } from './types';

/** ABN checksum: subtract 1 from the first digit, weight, sum, divisible by 89. */
export function isValidAbn(value: string): boolean {
  const digits = value.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split('').map(Number);
  nums[0] -= 1;
  return nums.reduce((sum, d, i) => sum + d * weights[i], 0) % 89 === 0;
}

export function formatAbn(value: string): string {
  const d = value.replace(/\s/g, '');
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : value;
}

export const AU_GST: TaxRegime = {
  id: 'AU_GST',
  country: 'AU',
  currency: 'AUD',
  taxName: 'GST',
  businessIdLabel: 'ABN',
  secondaryBusinessIdLabel: 'ACN',
  codes: [
    { code: 'GST', label: 'GST 10%', rateBps: 1000 },
    { code: 'GST_FREE', label: 'GST free', rateBps: 0, description: 'e.g. some food, medical, education, exports' },
    { code: 'INPUT_TAXED', label: 'Input taxed', rateBps: 0, description: 'e.g. residential rent, financial supplies' },
    { code: 'NO_GST', label: 'No GST (BAS excluded)', rateBps: 0 },
  ],
  defaultCode: 'GST',
  pricesIncludeTaxDefault: false,
  documentTitle(kind, taxRegistered) {
    if (kind === 'quote') return 'Quote';
    if (kind === 'receipt') return taxRegistered ? 'Tax Receipt' : 'Receipt';
    return taxRegistered ? 'Tax Invoice' : 'Invoice';
  },
  validateBusinessId: isValidAbn,
  formatBusinessId: formatAbn,
  documentWarnings({ kind, totalCents, taxRegistered, businessId, buyerName, buyerBusinessId }) {
    const warnings: string[] = [];
    if (kind !== 'invoice') return warnings;
    if (taxRegistered && !businessId) warnings.push('A tax invoice must show your ABN. Add it in business settings.');
    if (businessId && !isValidAbn(businessId)) warnings.push('Your ABN does not look valid.');
    // ATO: tax invoices of $1,000 or more (incl. GST) must show the buyer's identity or ABN.
    if (taxRegistered && totalCents >= 100_000 && !buyerName && !buyerBusinessId) {
      warnings.push("Tax invoices of $1,000 or more must show the buyer's name or ABN.");
    }
    return warnings;
  },
};

export const NZ_GST: TaxRegime = {
  id: 'NZ_GST',
  country: 'NZ',
  currency: 'NZD',
  taxName: 'GST',
  businessIdLabel: 'GST number',
  codes: [
    { code: 'GST', label: 'GST 15%', rateBps: 1500 },
    { code: 'ZERO', label: 'Zero rated', rateBps: 0 },
    { code: 'EXEMPT', label: 'Exempt', rateBps: 0 },
  ],
  defaultCode: 'GST',
  pricesIncludeTaxDefault: true,
  documentTitle(kind, taxRegistered) {
    if (kind === 'quote') return 'Quote';
    return taxRegistered ? 'Tax Invoice' : 'Invoice';
  },
};

export const NO_TAX: TaxRegime = {
  id: 'NONE',
  country: '*',
  currency: 'AUD',
  taxName: 'Tax',
  businessIdLabel: 'Business number',
  codes: [{ code: 'NONE', label: 'No tax', rateBps: 0 }],
  defaultCode: 'NONE',
  pricesIncludeTaxDefault: false,
  documentTitle(kind) {
    return kind === 'quote' ? 'Quote' : kind === 'receipt' ? 'Receipt' : 'Invoice';
  },
};

const REGIMES: Record<string, TaxRegime> = { AU_GST, NZ_GST, NONE: NO_TAX };

export function getTaxRegime(id: string | null | undefined): TaxRegime {
  return REGIMES[id ?? ''] ?? AU_GST;
}

export function listTaxRegimes(): TaxRegime[] {
  return Object.values(REGIMES);
}
