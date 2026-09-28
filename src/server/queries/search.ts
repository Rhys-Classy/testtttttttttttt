import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { pgArray } from '@/db/sql';

export type SearchResult = {
  type: 'contact' | 'company' | 'lead' | 'deal' | 'job' | 'quote' | 'invoice' | 'payment' | 'task' | 'message';
  id: string;
  subAccountId: string;
  title: string;
  subtitle: string | null;
  href: string;
};

/**
 * One query across every record type in the businesses visible to this request.
 * Every result carries its business so "John Smith" in two businesses is never confused.
 */
export async function globalSearch(tx: Tx, ids: string[], q: string, limitPerType = 6): Promise<SearchResult[]> {
  const term = q.trim();
  if (!term || !ids.length) return [];
  const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const digits = term.replace(/\D/g, '');
  const phoneLike = digits.length >= 4 ? `%${digits.slice(-9)}%` : null;
  const res = await tx.execute<Omit<SearchResult, 'subAccountId'> & { sub_account_id: string }>(sql`
    (select 'contact' as type, c.id, c.sub_account_id, trim(c.first_name || ' ' || c.last_name) as title,
        coalesce(c.email, c.phone, initcap(c.status)) as subtitle, '/contacts/' || c.id as href
      from contacts c where c.sub_account_id = any(${pgArray(ids)}) and c.archived_at is null and (
        (c.first_name || ' ' || c.last_name) ilike ${like} or c.email ilike ${like}
        ${phoneLike ? sql`or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like ${phoneLike}` : sql``})
      order by c.updated_at desc limit ${limitPerType})
    union all
    (select 'company', co.id, co.sub_account_id, co.name, co.email, '/contacts?company=' || co.id
      from companies co where co.sub_account_id = any(${pgArray(ids)}) and co.name ilike ${like} limit ${limitPerType})
    union all
    (select 'lead', l.id, l.sub_account_id, coalesce(l.title, trim(c.first_name || ' ' || c.last_name)), 'Lead · ' || l.status || ' · ' || l.source, '/contacts/' || c.id
      from leads l join contacts c on c.id = l.contact_id and c.sub_account_id = l.sub_account_id
      where l.sub_account_id = any(${pgArray(ids)}) and (l.title ilike ${like} or (c.first_name || ' ' || c.last_name) ilike ${like}) limit ${limitPerType})
    union all
    (select 'deal', d.id, d.sub_account_id, d.title, 'Deal · ' || d.status, '/pipeline?deal=' || d.id
      from deals d where d.sub_account_id = any(${pgArray(ids)}) and d.title ilike ${like} limit ${limitPerType})
    union all
    (select 'job', j.id, j.sub_account_id, j.number || ' ' || j.title, 'Job · ' || replace(j.status, '_', ' '), '/jobs/' || j.id
      from jobs j where j.sub_account_id = any(${pgArray(ids)}) and (j.title ilike ${like} or j.number ilike ${like}) limit ${limitPerType})
    union all
    (select 'quote', q.id, q.sub_account_id, q.number || coalesce(' ' || q.title, ''), 'Quote · ' || q.status || ' · $' || to_char(q.total_cents / 100.0, 'FM999G999G990D00'), '/quotes/' || q.id
      from quotes q left join contacts c on c.id = q.contact_id and c.sub_account_id = q.sub_account_id
      where q.sub_account_id = any(${pgArray(ids)}) and (q.number ilike ${like} or q.title ilike ${like} or (c.first_name || ' ' || c.last_name) ilike ${like}) limit ${limitPerType})
    union all
    (select 'invoice', i.id, i.sub_account_id, i.number || coalesce(' ' || i.title, ''), 'Invoice · ' || replace(i.status, '_', ' ') || ' · $' || to_char(i.total_cents / 100.0, 'FM999G999G990D00'), '/invoices/' || i.id
      from invoices i left join contacts c on c.id = i.contact_id and c.sub_account_id = i.sub_account_id
      where i.sub_account_id = any(${pgArray(ids)}) and (i.number ilike ${like} or i.title ilike ${like} or (c.first_name || ' ' || c.last_name) ilike ${like}) limit ${limitPerType})
    union all
    (select 'payment', p.id, p.sub_account_id, '$' || to_char(p.amount_cents / 100.0, 'FM999G999G990D00') || ' ' || p.method, 'Payment · ' || p.status, coalesce('/invoices/' || p.invoice_id, '/payments')
      from payments p where p.sub_account_id = any(${pgArray(ids)}) and (p.reference ilike ${like} or p.provider_payment_id ilike ${like}) limit ${limitPerType})
    union all
    (select 'task', t.id, t.sub_account_id, t.title, 'Task · ' || replace(t.status, '_', ' '), '/tasks?t=' || t.id
      from tasks t where t.sub_account_id = any(${pgArray(ids)}) and t.title ilike ${like} and t.status <> 'done' limit ${limitPerType})
    union all
    (select 'message', m.id, m.sub_account_id, left(m.body, 80), 'Message · ' || m.channel, '/inbox?c=' || m.conversation_id
      from messages m where m.sub_account_id = any(${pgArray(ids)}) and m.body ilike ${like} and not m.is_internal_note
      order by m.created_at desc limit ${limitPerType})
  `);
  return res.rows.map((r) => ({ type: r.type, id: r.id, subAccountId: r.sub_account_id, title: r.title || 'Untitled', subtitle: r.subtitle, href: r.href }));
}
