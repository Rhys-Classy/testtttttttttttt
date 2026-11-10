import { formatNumber } from "../lib/format";

interface StatStripProps {
  live: number;
  total: number;
  executed: number;
  leads: number;
  /** Hours of human work the crew has stood in for. */
  hours: number;
}

/** The four numbers that say whether the crew is earning its keep. */
export function StatStrip({ live, total, executed, leads, hours }: StatStripProps) {
  const stats = [
    { label: "OPERATIVES_LIVE", value: `${live}/${total}`, note: "in the field right now", tone: "text-acid" },
    { label: "DIRECTIVES_EXECUTED", value: formatNumber(executed), note: "jobs finished without you", tone: "text-ink" },
    { label: "LEADS_QUEUED", value: formatNumber(leads), note: "scored and waiting", tone: "text-cyan" },
    { label: "HOURS_RECLAIMED", value: `${hours.toFixed(1)}h`, note: "of your time handed back", tone: "text-pink" },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px border border-line bg-line xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-panel px-4 py-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">{stat.label}</dt>
          <dd className={`mt-1 font-mono text-2xl font-bold tabular-nums leading-tight ${stat.tone}`}>
            {stat.value}
          </dd>
          <dd className="mt-0.5 hidden truncate text-xs text-mute sm:block">{stat.note}</dd>
        </div>
      ))}
    </dl>
  );
}
