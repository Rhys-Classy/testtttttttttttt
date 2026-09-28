import { eq } from 'drizzle-orm';
import { subAccounts } from '@/db/schema';
import { apiRoute } from '@/server/api/v1';

/** GET /api/v1 — who am I: the business this key works in, its permissions, and the endpoints. */
export const GET = apiRoute(null, async (_req, { tx, key }) => {
  const [b] = await tx.select({ id: subAccounts.id, name: subAccounts.name, timezone: subAccounts.timezone, currency: subAccounts.currency }).from(subAccounts).where(eq(subAccounts.id, key.subAccountId));
  return {
    body: {
      data: {
        business: b, key: { name: key.name, permissions: key.permissions },
        endpoints: [
          'GET /api/v1/contacts', 'POST /api/v1/contacts', 'GET /api/v1/contacts/{id}', 'PATCH /api/v1/contacts/{id}',
          'GET /api/v1/leads', 'POST /api/v1/leads', 'GET /api/v1/invoices', 'GET /api/v1/invoices/{id}', 'GET /api/v1/payments',
          'GET /api/v1/tasks', 'POST /api/v1/tasks', 'GET /api/v1/jobs', 'GET /api/v1/calendar.ics',
        ],
        docs: 'See API.md in the repository.',
      },
    },
  };
});
