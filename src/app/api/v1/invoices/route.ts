import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { invoices } from '@/db/schema';
import { apiRoute, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiInvoice } from '@/server/api/serialize';

const ListQuery = listQuery.extend({
  status: z.enum(['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'cancelled']).optional(),
  contact_id: z.string().uuid().optional(),
});
const SORTS = {
  created_at: { column: invoices.createdAt, kind: 'date' as const },
  updated_at: { column: invoices.updatedAt, kind: 'date' as const },
  number: { column: invoices.number, kind: 'text' as const },
};

/** GET /api/v1/invoices?status=&contact_id=&sort=-created_at&limit=&cursor= (read-only in v1) */
export const GET = apiRoute('invoices.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, invoices.id, q.sort, q.cursor);
  const rows = await tx.select().from(invoices).where(and(
    eq(invoices.subAccountId, scope.subAccountId),
    q.status ? eq(invoices.status, q.status) : undefined,
    q.contact_id ? eq(invoices.contactId, q.contact_id) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => (ks.name === 'number' ? r.number : ks.name === 'updated_at' ? r.updatedAt : r.createdAt));
  return { body: { data: page.rows.map((r) => apiInvoice(r)), next_cursor: page.nextCursor } };
});
