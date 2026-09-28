export type TaxCode = {
  code: string;
  label: string;
  /** Basis points: 1000 = 10%. */
  rateBps: number;
  description?: string;
};

export type DocumentKind = 'invoice' | 'quote' | 'receipt';

export type TaxRegime = {
  id: string;
  country: string;
  currency: string;
  /** What the tax is called on documents, e.g. 'GST', 'VAT'. */
  taxName: string;
  /** Business identifier label, e.g. 'ABN'. */
  businessIdLabel: string;
  secondaryBusinessIdLabel?: string;
  codes: TaxCode[];
  defaultCode: string;
  /** Document heading, e.g. 'Tax Invoice' for a GST-registered Australian business. */
  documentTitle(kind: DocumentKind, taxRegistered: boolean): string;
  validateBusinessId?(value: string): boolean;
  formatBusinessId?(value: string): string;
  /** Compliance checks shown as warnings before sending a document. */
  documentWarnings?(doc: { kind: DocumentKind; totalCents: number; taxRegistered: boolean; businessId?: string | null; buyerName?: string | null; buyerBusinessId?: string | null }): string[];
  pricesIncludeTaxDefault: boolean;
};
