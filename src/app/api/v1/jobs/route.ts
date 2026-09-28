import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { jobs } from '@/db/schema';
import { apiRoute, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiJob } from '@/server/api/serialize';

const ListQuery = listQuery.extend({ status: z.string().trim().max(30).optional(), contact_id: z.string().uuid().optional() });
const SORTS = { created_at: { column: jobs.createdAt, kind: 'date' as const }, updated_at: { column: jobs.updatedAt, kind: 'date' as const } };

/** GET /api/v1/jobs?status=&contact_id=&limit=&cursor= */
export const GET = apiRoute('jobs.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, jobs.id, q.sort, q.cursor);
  const rows = await tx.select().from(jobs).where(and(
    eq(jobs.subAccountId, scope.subAccountId),
    q.status ? eq(jobs.status, q.status as never) : undefined,
    q.contact_id ? eq(jobs.contactId, q.contact_id) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => (ks.name === 'updated_at' ? r.updatedAt : r.createdAt));
  return { body: { data: page.rows.map(apiJob), next_cursor: page.nextCursor } };
});
