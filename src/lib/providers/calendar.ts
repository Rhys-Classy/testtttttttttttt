/**
 * Calendar provider abstraction. Two-way sync (Google/Microsoft) needs OAuth app
 * registration and is NOT implemented yet; the ICS feed provider is real and lets
 * any calendar app (Google, Apple, Outlook) subscribe to a business's bookings.
 */
export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  description?: string | null;
  allDay?: boolean;
  status?: 'confirmed' | 'cancelled' | 'tentative';
};

export interface CalendarProvider {
  readonly key: string;
  readonly label: string;
  readonly status: 'available' | 'not_implemented';
  /** Read-only feed of events (ICS). */
  feed?(calendarName: string, events: CalendarEvent[], tz: string): string;
  /** Two-way sync. */
  pushEvent?(event: CalendarEvent): Promise<{ externalId: string }>;
  listBusy?(from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export const icsCalendarProvider: CalendarProvider = {
  key: 'ics',
  label: 'Calendar feed (ICS)',
  status: 'available',
  feed(calendarName, events, tz) {
    const now = utc(new Date());
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Business OS//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeText(calendarName)}`, `X-WR-TIMEZONE:${tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    ];
    for (const e of events) {
      lines.push('BEGIN:VEVENT', `UID:${e.id}@business-os`, `DTSTAMP:${now}`);
      if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.startsAt)}`, `DTEND;VALUE=DATE:${dateOnly(e.endsAt)}`);
      else lines.push(`DTSTART:${utc(e.startsAt)}`, `DTEND:${utc(e.endsAt)}`);
      lines.push(`SUMMARY:${escapeText(e.title)}`);
      if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
      if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
      lines.push(`STATUS:${(e.status ?? 'confirmed').toUpperCase()}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  },
};

export const googleCalendarProvider: CalendarProvider = { key: 'google_calendar', label: 'Google Calendar (two-way)', status: 'not_implemented' };
export const microsoftCalendarProvider: CalendarProvider = { key: 'microsoft_calendar', label: 'Outlook / Microsoft 365 (two-way)', status: 'not_implemented' };
