import type { StatTile } from "../lib/engine";

const TONE: Record<StatTile["tone"], string> = {
  acid: "text-acid",
  ink: "text-ink",
  cyan: "text-cyan",
  pink: "text-pink",
};

/** The four numbers that say whether the crew is earning its keep. */
export function StatStrip({ tiles }: { tiles: readonly StatTile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px border border-line bg-line xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-panel px-4 py-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">{tile.label}</dt>
          <dd className={`mt-1 font-mono text-2xl font-bold tabular-nums leading-tight ${TONE[tile.tone]}`}>
            {tile.value}
          </dd>
          <dd className="mt-0.5 hidden truncate text-xs text-mute sm:block">{tile.note}</dd>
        </div>
      ))}
    </dl>
  );
}
