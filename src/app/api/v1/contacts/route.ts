import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts } from '@/db/schema';
import { apiRoute, body, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiContact } from '@/server/api/serialize';
import { createContact } from '@/server/services/crm';
import { LEAD_SOURCES } from '@/server/api/serialize';

const ListQuery = listQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['lead', 'customer', 'inactive']).optional(),
  tag: z.string().trim().max(60).optional(),
  email: z.string().trim().max(200).optional(),
  include_archived: z.enum(['true', 'false']).optional(),
});

const SORTS = { created_at: { column: contacts.createdAt, kind: 'date' as const }, updated_at: { column: contacts.updatedAt, kind: 'date' as const }, last_name: { column: contacts.lastName, kind: 'text' as const } };

/** GET /api/v1/contacts?q=&status=&tag=&email=&sort=-created_at&limit=25&cursor= */
export const GET = apiRoute('contacts.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, contacts.id, q.sort, q.cursor);
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const rows = await tx.select().from(contacts).where(and(
    eq(contacts.subAccountId, scope.subAccountId),
    q.include_archived === 'true' ? undefined : isNull(contacts.archivedAt),
    q.status ? eq(contacts.status, q.status) : undefined,
    q.tag ? sql`${q.tag} = any(${contacts.tags})` : undefined,
    q.email ? eq(sql`lower(${contacts.email})`, q.email.toLowerCase()) : undefined,
    like ? or(ilike(contacts.firstName, like), ilike(contacts.lastName, like), ilike(contacts.email, like), ilike(contacts.phone, like)) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => (ks.name === 'last_name' ? r.lastName : ks.name === 'updated_at' ? r.updatedAt : r.createdAt));
  return { body: { data: page.rows.map(apiContact), next_cursor: page.nextCursor } };
});

const Create = z.object({
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(200).optional(),
  status: z.enum(['lead', 'customer', 'inactive']).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => v.name || v.first_name || v.last_name || v.email || v.phone, 'Give a name, email or phone.');

/** POST /api/v1/contacts */
export const POST = apiRoute('contacts.edit', async (req, { tx, scope }) => {
  const b = await body(Create, req);
  const c = await createContact(tx, scope, {
    name: b.name, firstName: b.first_name, lastName: b.last_name, email: b.email ?? null, phone: b.phone ?? null, companyName: b.company ?? null,
    status: b.status, tags: b.tags, source: b.source ?? 'other', customFields: b.custom_fields,
  });
  return { status: 201, body: { data: apiContact(c) } };
});
