import { formatMoney } from '@/lib/money';

/**
 * Single-series charts in plain HTML/CSS: one hue (validated --chart-1 per theme),
 * <=24px bars with a 4px rounded data end, 2px surface gaps, hover/focus tooltips,
 * selective labels, and a table view so nothing depends on seeing the chart.
 */

export function MonthlyColumns({ data, label }: { data: { month: string; cents: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.cents));
  const maxIdx = data.findIndex((d) => d.cents === max);
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' });
  return (
    <figure>
      <div className="flex h-48 items-end gap-[2px] border-b border-chart-grid" role="img" aria-label={`${label}: ${data.map((d) => `${monthLabel(d.month)} ${formatMoney(d.cents)}`).join(', ')}`}>
        {data.map((d, i) => {
          const h = Math.max(d.cents ? 2 : 0, (d.cents / max) * 100);
          const labelled = i === maxIdx || i === data.length - 1;
          return (
            <div key={d.month} className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none" tabIndex={0}>
              {labelled && d.cents ? <span className="mb-1 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted group-hover:invisible group-focus:invisible">{formatMoney(d.cents, 'AUD', 'en-AU', { compact: true })}</span> : null}
              <div className="w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80" style={{ height: `${h}%` }} />
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg border border-border bg-surface px-2 py-1 text-xs shadow-lg group-hover:block group-focus:block">
                <span className="text-muted">{monthLabel(d.month)}</span> <span className="font-semibold tabular-nums">{formatMoney(d.cents)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px] text-center text-[11px] text-muted">{data.map((d) => <span key={d.month} className="flex-1">{monthLabel(d.month)}</span>)}</div>
      <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full"><tbody>{data.map((d) => <tr key={d.month} className="border-t border-border"><td className="py-1">{d.month}</td><td className="py-1 text-right tabular-nums text-text">{formatMoney(d.cents)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

export function HorizontalBars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-[2px]">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[7rem_1fr] items-center gap-3 py-1 text-sm" title={`${r.label}: ${r.value}${r.sub ? ` (${r.sub})` : ''}`}>
          <span className="truncate text-muted">{r.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-5 rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(r.value ? 2 : 0, (r.value / max) * 85)}%` }} />
            <span className="shrink-0 tabular-nums">{r.value}{r.sub ? <span className="text-muted"> · {r.sub}</span> : null}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
