import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { contacts, products } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { readScope, type AppContext } from '@/server/context';
import { grantAllows } from '@/lib/permissions';
import { contactName } from '@/server/services/crm';
import type { EditorProduct } from '@/components/documents/doc-editor';

export async function editorData(ctx: AppContext, businessIds: string[], contactId?: string | null) {
  return readScope({ ...ctx, scopeIds: businessIds }, async (tx) => {
    const rows = await tx.select().from(products).where(and(sql`${products.subAccountId} = any(${pgArray(businessIds)})`, eq(products.active, true))).orderBy(asc(products.name));
    const byBiz: Record<string, EditorProduct[]> = {};
    for (const p of rows) (byBiz[p.subAccountId] ??= []).push({ id: p.id, name: p.name, priceCents: p.priceCents, taxCode: p.taxCode, description: p.description });
    let contact: { id: string; label: string; subAccountId: string } | null = null;
    if (contactId) {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      if (c) contact = { id: c.id, label: contactName(c), subAccountId: c.subAccountId };
    }
    return { products: byBiz, contact };
  });
}

export function editorBusinesses(ctx: AppContext, module: 'invoices' | 'quotes') {
  return (ctx.current ? [ctx.current] : ctx.businesses)
    .filter((b) => b.enabledModules.includes(module) && grantAllows(ctx.grants[b.id], module === 'invoices' ? 'invoices.edit' : 'quotes.edit'))
    .map((b) => ({ id: b.id, name: b.name, taxRegime: b.taxRegime, taxRegistered: b.taxRegistered }));
}
