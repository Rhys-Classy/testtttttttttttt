import Link from 'next/link';
import { cn } from '@/lib/cn';

/** In All Businesses view, narrow a list to one business without switching context. */
export function BusinessFilter({ businesses, active, hrefFor }: { businesses: { id: string; name: string; shortName: string | null; color: string }[]; active?: string; hrefFor: (id?: string) => string }) {
  if (businesses.length < 2) return null;
  return (
    <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      <Link href={hrefFor(undefined)} className={cn('flex h-8 shrink-0 items-center rounded-full border px-3 text-xs', !active ? 'border-text font-medium' : 'border-border text-muted')}>All</Link>
      {businesses.map((b) => (
        <Link key={b.id} href={hrefFor(b.id)} className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs', active === b.id ? 'border-text font-medium' : 'border-border text-muted')}>
          <span className="size-2 rounded-full" style={{ backgroundColor: b.color }} />{b.shortName ?? b.name}
        </Link>
      ))}
    </div>
  );
}
