import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { tasks } from '@/db/schema';
import { apiRoute, body, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiTask } from '@/server/api/serialize';
import { createTask } from '@/server/services/work';

const ListQuery = listQuery.extend({ status: z.enum(['todo', 'in_progress', 'snoozed', 'done']).optional(), contact_id: z.string().uuid().optional() });
const SORTS = { created_at: { column: tasks.createdAt, kind: 'date' as const }, updated_at: { column: tasks.updatedAt, kind: 'date' as const } };

/** GET /api/v1/tasks?status=&contact_id=&sort=-created_at&limit=&cursor= */
export const GET = apiRoute('tasks.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, tasks.id, q.sort, q.cursor);
  const rows = await tx.select().from(tasks).where(and(
    eq(tasks.subAccountId, scope.subAccountId),
    q.status ? eq(tasks.status, q.status) : undefined,
    q.contact_id ? eq(tasks.contactId, q.contact_id) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => (ks.name === 'updated_at' ? r.updatedAt : r.createdAt));
  return { body: { data: page.rows.map(apiTask), next_cursor: page.nextCursor } };
});

const Create = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  contact_id: z.string().uuid().optional(),
});

/** POST /api/v1/tasks */
export const POST = apiRoute('tasks.edit', async (req, { tx, scope }) => {
  const b = await body(Create, req);
  const t = await createTask(tx, scope, {
    title: b.title, description: b.description ?? null, dueAt: b.due_at ? new Date(b.due_at) : null, priority: b.priority, contactId: b.contact_id ?? null, source: 'manual',
  });
  return { status: 201, body: { data: apiTask(t) } };
});
