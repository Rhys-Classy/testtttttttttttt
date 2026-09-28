import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { leads } from '@/db/schema';
import { apiRoute, body, keyset, listQuery, parseQuery } from '@/server/api/v1';
import { apiContact, apiLead, LEAD_SOURCES } from '@/server/api/serialize';
import { createLead } from '@/server/services/crm';

const ListQuery = listQuery.extend({
  status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
});
const SORTS = { created_at: { column: leads.createdAt, kind: 'date' as const }, updated_at: { column: leads.updatedAt, kind: 'date' as const } };

/** GET /api/v1/leads?status=&source=&sort=-created_at&limit=&cursor= */
export const GET = apiRoute('sales.view', async (req, { tx, scope }) => {
  const q = parseQuery(req, ListQuery);
  const ks = keyset(SORTS, leads.id, q.sort, q.cursor);
  const rows = await tx.select().from(leads).where(and(
    eq(leads.subAccountId, scope.subAccountId),
    q.status ? eq(leads.status, q.status) : undefined,
    q.source ? eq(leads.source, q.source) : undefined,
    ks.where,
  )).orderBy(...ks.order).limit(q.limit + 1);
  const page = ks.next(rows, q.limit, (r) => (ks.name === 'updated_at' ? r.updatedAt : r.createdAt));
  return { body: { data: page.rows.map(apiLead), next_cursor: page.nextCursor } };
});

const Create = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.enum(LEAD_SOURCES).default('website'),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
  value_cents: z.number().int().min(0).max(1_000_000_000).optional(),
}).refine((v) => v.name || v.email || v.phone, 'Give a name, email or phone.');

/**
 * POST /api/v1/leads — the Zapier / website-form entry point. Matches an existing
 * contact by email/phone, creates the lead and fires "New lead" automations.
 */
export const POST = apiRoute('sales.edit', async (req, { tx, scope }) => {
  const b = await body(Create, req);
  const { lead, contact } = await createLead(tx, scope, {
    name: b.name, email: b.email ?? null, phone: b.phone ?? null, source: b.source, title: b.title ?? null, notes: b.notes ?? null, valueCents: b.value_cents ?? 0,
  });
  return { status: 201, body: { data: { ...apiLead(lead), contact: apiContact(contact) } } };
});
