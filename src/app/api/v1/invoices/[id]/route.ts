import { z } from 'zod';
import { ApiError, apiRoute } from '@/server/api/v1';
import { apiInvoice } from '@/server/api/serialize';
import { getInvoice, getInvoiceLines } from '@/server/services/finance';

/** GET /api/v1/invoices/{id} — with line items. */
export const GET = apiRoute<{ id: string }>('invoices.view', async (_req, { tx, scope }, { id }) => {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, 'not_found', 'Invoice not found.');
  const inv = await getInvoice(tx, scope, id);
  return { body: { data: apiInvoice(inv, await getInvoiceLines(tx, scope, id)) } };
});
