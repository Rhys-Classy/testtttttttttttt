import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { payments } from '@/db/schema';
import { apiRoute, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiPayment } from '@/server/api/serialize';

const ListQuery = listQuery.extend({
  status: z.enum(['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded']).optional(),
  invoice_id: z.string().uuid().optional(),
});
const SORTS = { created_at: { column: payments.createdAt, kind: 'date' as const } };

/** GET /api/v1/payments?status=&invoice_id=&limit=&cursor= */
export const GET = apiRoute('payments.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, payments.id, q.sort, q.cursor);
  const rows = await tx.select().from(payments).where(and(
    eq(payments.subAccountId, scope.subAccountId),
    q.status ? eq(payments.status, q.status) : undefined,
    q.invoice_id ? eq(payments.invoiceId, q.invoice_id) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => r.createdAt);
  return { body: { data: page.rows.map(apiPayment), next_cursor: page.nextCursor } };
});
