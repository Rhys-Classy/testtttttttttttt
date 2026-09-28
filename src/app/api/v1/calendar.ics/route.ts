import { and, eq, gte, lt, ne, or } from 'drizzle-orm';
import { appointments, jobs, subAccounts } from '@/db/schema';
import { apiRoute } from '@/server/api/v1';
import { icsCalendarProvider, type CalendarEvent } from '@/lib/providers/calendar';

/**
 * GET /api/v1/calendar.ics — subscribe from Google/Apple/Outlook calendar.
 * Calendar apps can't send headers, so this one endpoint also accepts ?key=.
 * Use a key that ONLY has "calendar.view".
 */
export const GET = apiRoute('calendar.view', async (_req, { tx, scope }) => {
  const [b] = await tx.select().from(subAccounts).where(eq(subAccounts.id, scope.subAccountId));
  const from = new Date(Date.now() - 30 * 86_400_000);
  const to = new Date(Date.now() + 180 * 86_400_000);
  const appts = await tx.select().from(appointments).where(and(eq(appointments.subAccountId, scope.subAccountId), gte(appointments.startsAt, from), lt(appointments.startsAt, to), ne(appointments.status, 'cancelled'))).limit(2000);
  const js = await tx.select().from(jobs).where(and(eq(jobs.subAccountId, scope.subAccountId), gte(jobs.scheduledStart, from), lt(jobs.scheduledStart, to), or(ne(jobs.status, 'cancelled')))).limit(1000);
  const events: CalendarEvent[] = [
    ...appts.map((a) => ({ id: a.id, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, location: a.location, description: a.notes })),
    ...js.filter((j) => j.scheduledStart).map((j) => ({
      id: j.id, title: `${j.number} ${j.title}`, startsAt: j.scheduledStart!, endsAt: j.scheduledEnd ?? new Date(j.scheduledStart!.getTime() + 8 * 3_600_000),
      location: [j.address?.line1, j.address?.suburb].filter(Boolean).join(', ') || null,
    })),
  ];
  const ics = icsCalendarProvider.feed!(b?.name ?? 'Business OS', events, b?.timezone ?? 'Australia/Melbourne');
  return { body: null, raw: new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' } }) };
}, { allowQueryKey: true });
