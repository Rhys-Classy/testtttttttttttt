const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number | null | undefined, currency = 'AUD', locale = 'en-AU', opts: { compact?: boolean } = {}): string {
  if (opts.compact) return compactMoney(cents ?? 0, currency);
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 });
    formatters.set(key, f);
  }
  return f.format((cents ?? 0) / 100);
}

/** Deterministic short form ($18.5k, $1.2M). Intl compact notation differs between Node and browsers. */
function compactMoney(cents: number, currency: string): string {
  const symbol = currency === 'AUD' || currency === 'NZD' || currency === 'USD' ? '$' : `${currency} `;
  const v = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  const trim = (n: number) => (Math.round(n * 10) / 10).toString();
  if (v >= 1_000_000) return `${sign}${symbol}${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${sign}${symbol}${trim(v / 1_000)}k`;
  return `${sign}${symbol}${Math.round(v)}`;
}

/** "$2,500", "2500.50", "2.5k" -> cents. Returns null when it doesn't look like money. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/[,\s]/g, '').replace(/^aud|aud$/g, '').replace(/\$/g, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = Number.parseFloat(m[1]);
  if (m[2] === 'k') n *= 1_000;
  if (m[2] === 'm') n *= 1_000_000;
  return Math.round(n * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}
