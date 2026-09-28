import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts } from '@/db/schema';
import { ApiError, apiRoute, body } from '@/server/api/v1';
import { apiContact } from '@/server/api/serialize';
import { updateContact } from '@/server/services/crm';

const Id = z.string().uuid();

/** GET /api/v1/contacts/{id} */
export const GET = apiRoute<{ id: string }>('contacts.view', async (_req, { tx, scope }, { id }) => {
  if (!Id.safeParse(id).success) throw new ApiError(404, 'not_found', 'Contact not found.');
  const [c] = await tx.select().from(contacts).where(and(eq(contacts.subAccountId, scope.subAccountId), eq(contacts.id, id)));
  if (!c) throw new ApiError(404, 'not_found', 'Contact not found.');
  return { body: { data: apiContact(c) } };
});

const Patch = z.object({
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  status: z.enum(['lead', 'customer', 'inactive']).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** PATCH /api/v1/contacts/{id} — only the fields you send change. */
export const PATCH = apiRoute<{ id: string }>('contacts.edit', async (req, { tx, scope }, { id }) => {
  if (!Id.safeParse(id).success) throw new ApiError(404, 'not_found', 'Contact not found.');
  const b = await body(Patch, req);
  const c = await updateContact(tx, scope, id, {
    firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone, status: b.status, customFields: b.custom_fields,
  });
  return { body: { data: apiContact(c) } };
});
