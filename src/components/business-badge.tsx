import { cn } from '@/lib/cn';

type B = { name: string; shortName?: string | null; color: string };

/** Always shows which business something belongs to: colour dot + short name. */
export function BusinessBadge({ business, full, className }: { business: B | null | undefined; full?: boolean; className?: string }) {
  if (!business) return null;
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-muted', className)} title={business.name}>
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: business.color }} aria-hidden />
      <span className="truncate">{full ? business.name : (business.shortName ?? business.name)}</span>
    </span>
  );
}

export function BusinessDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} aria-hidden />;
}
