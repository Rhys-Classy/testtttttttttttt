import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Previous / next links that keep the current filters. */
export function Pager({ path, params, page, hasNext, shown }: { path: string; params: Record<string, string | string[] | undefined>; page: number; hasNext: boolean; shown: number }) {
  if (page === 1 && !hasNext) return null;
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (k !== 'page' && typeof v === 'string' && v) q.set(k, v);
    if (n > 1) q.set('page', String(n));
    const s = q.toString();
    return `${path}${s ? `?${s}` : ''}`;
  };
  const from = (page - 1) * 50 + 1;
  const cls = 'inline-flex h-10 items-center gap-1 rounded-xl border border-border px-3 text-sm hover:bg-surface-2';
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2 text-sm text-muted">
      <span>{from}–{from + shown - 1}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className={cls}><ChevronLeft className="size-4" />Newer</Link> : null}
        {hasNext ? <Link href={href(page + 1)} className={cls}>Older<ChevronRight className="size-4" /></Link> : null}
      </span>
    </nav>
  );
}
