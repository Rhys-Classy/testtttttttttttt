'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchAction, type SearchHit } from '@/server/actions/shell';

/**
 * Type-ahead contact search. Picking a contact also fixes the business
 * (a contact only ever belongs to one), so the form doesn't ask twice.
 */
export function ContactPicker({ name = 'contactId', required, onPick, placeholder = 'Search customer…', initial }: {
  name?: string;
  required?: boolean;
  onPick?: (hit: SearchHit | null) => void;
  placeholder?: string;
  initial?: { id: string; label: string; subAccountId: string } | null;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [picked, setPicked] = useState<{ id: string; label: string; subAccountId: string; color?: string; business?: string } | null>(initial ?? null);

  useEffect(() => {
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => searchAction(q).then((r) => setHits(r.filter((h) => h.type === 'contact').slice(0, 8))), 150);
    return () => clearTimeout(t);
  }, [q]);

  if (picked) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm">
        <input type="hidden" name={name} value={picked.id} />
        <input type="hidden" name="subAccountId" value={picked.subAccountId} />
        {picked.color ? <span className="size-2.5 rounded-full" style={{ backgroundColor: picked.color }} /> : null}
        <span className="flex-1 truncate font-medium">{picked.label}</span>
        {picked.business ? <span className="truncate text-xs text-muted">{picked.business}</span> : null}
        <button type="button" onClick={() => { setPicked(null); onPick?.(null); }} aria-label="Clear" className="text-muted"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} required={required}
        className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none" />
      {hits.length ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {hits.map((h) => (
            <button type="button" key={h.id} onClick={() => { const p = { id: h.id, label: h.title, subAccountId: h.subAccountId, color: h.business?.color, business: h.business?.shortName ?? h.business?.name }; setPicked(p); onPick?.(h); setQ(''); setHits([]); }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: h.business?.color }} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.title}</span><span className="block truncate text-xs text-muted">{h.subtitle}</span></span>
              <span className="text-xs text-muted">{h.business?.shortName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
