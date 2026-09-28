import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Calm list instead of wide tables: title, one line of context, one number on the right. */
export function List({ children, className, asDiv }: { children: ReactNode; className?: string; asDiv?: boolean }) {
  const cls = cn('divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface', className);
  return asDiv ? <div className={cls}>{children}</div> : <ul className={cls}>{children}</ul>;
}

export function ListRow({ href, icon, title, meta, right, rightSub, className, asDiv }: {
  href?: string; icon?: ReactNode; title: ReactNode; meta?: ReactNode; right?: ReactNode; rightSub?: ReactNode; className?: string; asDiv?: boolean;
}) {
  const inner = (
    <>
      {icon ? <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {meta ? <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">{meta}</div> : null}
      </div>
      {right !== undefined ? (
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">{right}</div>
          {rightSub ? <div className="mt-0.5 text-xs text-muted">{rightSub}</div> : null}
        </div>
      ) : null}
      {href ? <ChevronRight className="size-4 shrink-0 text-muted" /> : null}
    </>
  );
  const Wrap = asDiv ? 'div' : 'li';
  return (
    <Wrap>
      {href ? (
        <Link href={href} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-surface-2', className)}>{inner}</Link>
      ) : (
        <div className={cn('flex items-center gap-3 px-4 py-3', className)}>{inner}</div>
      )}
    </Wrap>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? 'page' : undefined}
          className={cn('flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm', t.key === active ? 'bg-text font-medium text-bg' : 'bg-surface text-muted hover:text-text border border-border')}>
          {t.label}
          {t.count !== undefined ? <span className={cn('rounded-full px-1.5 text-xs', t.key === active ? 'bg-bg/20' : 'bg-surface-2')}>{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
