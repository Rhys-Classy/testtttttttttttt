/**
 * Timezone-aware helpers built on Intl (no extra dependency). Every business has
 * its own timezone (default Australia/Melbourne); "today" always means today
 * where the business is.
 */

export const DEFAULT_TZ = 'Australia/Melbourne';
export const DEFAULT_LOCALE = 'en-AU';

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function zonedParts(date: Date, tz = DEFAULT_TZ): Parts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as Parts;
}

/** Offset (minutes) of `tz` from UTC at the given instant. Melbourne is +600 or +660. */
export function tzOffsetMinutes(date: Date, tz = DEFAULT_TZ): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant for a wall-clock time in `tz`. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh = 0, mm = 0, tz = DEFAULT_TZ): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, tz);
  let result = new Date(guess.getTime() - offset * 60_000);
  // Correct across DST boundaries.
  const offset2 = tzOffsetMinutes(result, tz);
  if (offset2 !== offset) result = new Date(guess.getTime() - offset2 * 60_000);
  return result;
}

/** 'YYYY-MM-DD' for the instant, in `tz`. */
export function toDateKey(date: Date, tz = DEFAULT_TZ): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayKey(tz = DEFAULT_TZ, now = new Date()): string {
  return toDateKey(now, tz);
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** [start, end) of a local day as UTC instants. */
export function dayRange(key: string, tz = DEFAULT_TZ): { start: Date; end: Date } {
  const [y, m, d] = key.split('-').map(Number);
  const next = addDaysKey(key, 1).split('-').map(Number);
  return { start: zonedTimeToUtc(y, m, d, 0, 0, tz), end: zonedTimeToUtc(next[0], next[1], next[2], 0, 0, tz) };
}

export function monthRange(key: string, tz = DEFAULT_TZ): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start: zonedTimeToUtc(y, m, 1, 0, 0, tz), end: zonedTimeToUtc(ny, nm, 1, 0, 0, tz) };
}

/** Monday-start week containing the key. */
export function weekRange(key: string, tz = DEFAULT_TZ): { start: Date; end: Date; startKey: string } {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun
  const startKey = addDaysKey(key, -((dow + 6) % 7));
  return { start: dayRange(startKey, tz).start, end: dayRange(addDaysKey(startKey, 7), tz).start, startKey };
}

export function formatDate(value: Date | string | null | undefined, tz = DEFAULT_TZ, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...opts, timeZone: tz }).format(new Date(value));
}

export function formatTime(value: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '';
  return `${formatDate(value, tz, { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatTime(value, tz)}`;
}

/** "in 3 days", "2 hours ago", "today". */
export function relativeTime(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return '';
  const diffMs = new Date(value).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(diffMs / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return rtf.format(Math.round(diffMs / (30 * day)), 'month');
}

/** Whole days between two YYYY-MM-DD keys (b - a). */
export function daysBetweenKeys(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}
