import 'server-only';
import { sql } from 'drizzle-orm';
import { withAnonymous } from '@/db/context';

/** Public links carry an unguessable token; the database tells us which business owns it. */
export async function resolvePublic(kind: 'invoice' | 'quote' | 'form' | 'landing_page', token: string): Promise<string | null> {
  if (!token || token.length < 8 || token.length > 64) return null;
  return withAnonymous(async (tx) => (await tx.execute<{ id: string | null }>(sql`select app.resolve_public(${kind}, ${token}) as id`)).rows[0]?.id ?? null);
}
