// Works out whether a retailer product page is buyable, from the page's HTML.
// Order of trust: your own per-item text rules, then schema.org JSON-LD
// (Big W, Target, Kmart, JB Hi-Fi and EB Games all publish it), then meta
// tags, then plain-text keywords as a last resort.

export const STATUS = Object.freeze({
  IN_STOCK: 'IN_STOCK',
  PREORDER: 'PREORDER',
  OUT: 'OUT_OF_STOCK',
  UNKNOWN: 'UNKNOWN',
  BLOCKED: 'BLOCKED',
  ERROR: 'ERROR',
});

export const BUYABLE = new Set([STATUS.IN_STOCK, STATUS.PREORDER]);

const RETAILERS = [
  ['bigw.com.au', 'BIG W'],
  ['ebgames.com.au', 'EB GAMES'],
  ['target.com.au', 'TARGET'],
  ['kmart.com.au', 'KMART'],
  ['jbhifi.com.au', 'JB HI-FI'],
  ['amazon.com.au', 'AMAZON AU'],
  ['pokemoncenter.com', 'POKEMON CENTER'],
  ['toymate.com.au', 'TOYMATE'],
  ['zingpopculture.com.au', 'ZING'],
  ['myer.com.au', 'MYER'],
];

export function retailerOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'UNKNOWN';
  }
  for (const [domain, name] of RETAILERS) {
    if (host === domain || host.endsWith('.' + domain)) return name;
  }
  return host.replace(/^www\./, '').toUpperCase();
}

export const KNOWN_RETAILERS = RETAILERS.map(([, name]) => name);

function mapAvailability(value) {
  const v = String(value).toLowerCase();
  if (/preorder|presale|backorder/.test(v)) return STATUS.PREORDER;
  if (/outofstock|soldout|discontinued|instoreonly/.test(v)) return STATUS.OUT;
  if (/instock|limitedavailability|onlineonly/.test(v)) return STATUS.IN_STOCK;
  return null;
}

function walk(node, found) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, found);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'availability' && typeof value === 'string') found.availability.push(value);
    else if ((key === 'price' || key === 'lowPrice') && (typeof value === 'number' || typeof value === 'string')) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) found.prices.push(n);
    } else walk(value, found);
  }
}

function fromJsonLd(html) {
  const found = { availability: [], prices: [] };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      walk(JSON.parse(m[1].trim()), found);
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  }
  return found;
}

function fromMeta(html) {
  const m =
    html.match(/<meta[^>]+(?:property|name)=["'](?:og:availability|product:availability)["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:availability|product:availability)["']/i);
  return m ? m[1] : null;
}

function fromEmbeddedJson(html) {
  // Next.js and similar pages carry product data in script blobs that are not JSON-LD.
  const m = html.match(/"availability"\s*:\s*"([^"]{2,60})"/i);
  return m ? m[1] : null;
}

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const OUT_WORDS = ['out of stock', 'sold out', 'currently unavailable', 'coming soon', 'notify me when available', 'no longer available'];
const PRE_WORDS = ['pre-order now', 'preorder now', 'pre order now', 'pre-order today'];
const IN_WORDS = ['add to cart', 'add to bag', 'add to trolley', 'buy now'];

function fromText(html) {
  const text = textOf(html);
  if (OUT_WORDS.some((w) => text.includes(w))) return STATUS.OUT;
  if (PRE_WORDS.some((w) => text.includes(w))) return STATUS.PREORDER;
  if (IN_WORDS.some((w) => text.includes(w))) return STATUS.IN_STOCK;
  return null;
}

/**
 * @param {string} html
 * @param {{inStockText?: string, outOfStockText?: string}} item
 * @returns {{status: string, source: string, price: number|null}}
 */
export function detectStock(html, item = {}) {
  const ld = fromJsonLd(html);
  const price = ld.prices.length ? Math.min(...ld.prices) : null;
  const lower = html.toLowerCase();

  if (item.outOfStockText && lower.includes(item.outOfStockText.toLowerCase())) {
    return { status: STATUS.OUT, source: 'custom', price };
  }
  if (item.inStockText && lower.includes(item.inStockText.toLowerCase())) {
    return { status: STATUS.IN_STOCK, source: 'custom', price };
  }

  for (const a of ld.availability) {
    const s = mapAvailability(a);
    if (s) return { status: s, source: 'jsonld', price };
  }

  const meta = fromMeta(html);
  if (meta && mapAvailability(meta)) return { status: mapAvailability(meta), source: 'meta', price };

  const embedded = fromEmbeddedJson(html);
  if (embedded && mapAvailability(embedded)) return { status: mapAvailability(embedded), source: 'embedded', price };

  const t = fromText(html);
  if (t) return { status: t, source: 'text', price };

  return { status: STATUS.UNKNOWN, source: 'none', price };
}
