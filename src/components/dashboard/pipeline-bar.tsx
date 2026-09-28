import Link from 'next/link';
import { formatMoney } from '@/lib/money';

type Stage = { id: string; name: string; kind: string; count: number; valueCents: number };

/** A calm, glanceable pipeline: one row per open stage, bar length = value. */
export function PipelineBar({ stages }: { stages: Stage[] }) {
  const open = stages.filter((s) => s.kind === 'open');
  const max = Math.max(1, ...open.map((s) => s.valueCents));
  const won = stages.find((s) => s.kind === 'won');
  return (
    <div className="space-y-2.5">
      {open.map((s) => (
        <Link key={s.id} href={`/pipeline?stage=${s.id}`} className="block">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{s.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{s.count} · {formatMoney(s.valueCents, 'AUD', 'en-AU', { compact: true })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(s.count ? 4 : 0, (s.valueCents / max) * 100)}%` }} />
          </div>
        </Link>
      ))}
      {won ? <p className="pt-1 text-xs text-muted">Won: {won.count} deals · {formatMoney(won.valueCents, 'AUD', 'en-AU', { compact: true })}</p> : null}
    </div>
  );
}
