import 'server-only';
import { sql } from 'drizzle-orm';
import { forms } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';

export async function formsByBusiness(ctx: AppContext, ids: string[]) {
  const rows = await readScope({ ...ctx, scopeIds: ids }, (tx) => tx.select({ id: forms.id, name: forms.name, publicId: forms.publicId, b: forms.subAccountId }).from(forms).where(sql`${forms.subAccountId} = any(${pgArray(ids)})`));
  const out: Record<string, { id: string; name: string; publicId: string }[]> = {};
  for (const id of ids) out[id] = rows.filter((r) => r.b === id).map(({ id: fid, name, publicId }) => ({ id: fid, name, publicId }));
  return out;
}
