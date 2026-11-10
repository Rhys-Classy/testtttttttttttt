import { cn } from "../lib/cn";
import { formatNumber } from "../lib/format";
import { PROFILES } from "../lib/mock-data";
import type { AccentKey, Agent, AgentId, Deliverable, Mode } from "../lib/types";

interface VaultProps {
  mode: Mode;
  deliverables: readonly Deliverable[];
  /** Used to list jobs that are still being written. */
  agents: readonly Agent[];
  /** A plain-language warning about storage, when there is one. */
  note: string | null;
  onOpenDeliverable: (id: string) => void;
  onOpenLive: (id: AgentId) => void;
}

const ACCENT_TEXT: Record<AccentKey, string> = {
  pink: "text-pink",
  cyan: "text-cyan",
  acid: "text-acid",
};

const ACCENT_BAR: Record<AccentKey, string> = {
  pink: "bg-pink",
  cyan: "bg-cyan",
  acid: "bg-acid",
};

/** How many finished pieces to list before pointing at the rest. */
const SHOWN = 50;

const ROW =
  "flex w-full items-center gap-3 rounded-none bg-panel px-4 py-3 text-left transition-colors duration-75 hover:bg-raised";

function when(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Everything the crew has actually produced, newest first, with jobs in
 * progress on top. In the simulation there is nothing real to list, so it says
 * so instead of showing pretend output.
 */
export function Vault({ mode, deliverables, agents, note, onOpenDeliverable, onOpenLive }: VaultProps) {
  if (mode !== "live") {
    return (
      <section aria-label="Vault" className="border border-line bg-panel px-4 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-ink">
          {mode === "linking" ? "Requesting Claude uplink" : "Simulation mode"}
        </h2>
        <p className="mt-1 max-w-[80ch] text-sm leading-6 text-mute">
          {mode === "linking"
            ? "Checking whether this page can reach Claude. This takes a few seconds."
            : "This copy has no AI connection, so the operatives are acting out a script and nothing they report is real. Open SYNDICATE.OS through Claude and the same crew writes real work for your business."}
        </p>
      </section>
    );
  }

  const working = agents.filter((agent) => agent.status === "active");
  const shown = deliverables.slice(0, SHOWN);

  return (
    <section aria-labelledby="vault-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="vault-title" className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-ink">
          Vault <span aria-hidden className="text-mute">{"//"}</span>{" "}
          <span className="text-mute">
            {formatNumber(deliverables.length)} {deliverables.length === 1 ? "piece" : "pieces"} of finished work
          </span>
        </h2>
        {deliverables.length > SHOWN && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            Showing the latest {SHOWN}
          </p>
        )}
      </div>

      {note && (
        <p role="status" className="mt-2 border border-pink/50 bg-pink/10 px-3 py-2 text-xs leading-5 text-ink">
          {note}
        </p>
      )}

      {working.length === 0 && deliverables.length === 0 ? (
        <p className="mt-2 border border-line bg-panel px-4 py-6 text-sm leading-6 text-mute">
          Nothing delivered yet. Deploy an operative and its finished work lands here, ready to
          read and copy.
        </p>
      ) : (
        <ul className="mt-2 grid gap-px border border-line bg-line">
          {working.map((agent) => {
            const accent = PROFILES[agent.id].accent;
            return (
              <li key={`live-${agent.id}`}>
                <button type="button" onClick={() => onOpenLive(agent.id)} className={ROW}>
                  <span aria-hidden className={cn("h-8 w-0.5 shrink-0 animate-blink", ACCENT_BAR[accent])} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block font-mono text-[10px] font-semibold uppercase tracking-[0.2em]", ACCENT_TEXT[accent])}>
                      {agent.id} <span aria-hidden>{"//"}</span> {agent.draft ? "writing" : "thinking"}
                    </span>
                    <span className="block truncate text-sm text-ink">{agent.task}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
                    Watch
                  </span>
                </button>
              </li>
            );
          })}
          {shown.map((item) => {
            const accent = PROFILES[item.agentId].accent;
            return (
              <li key={item.id}>
                <button type="button" onClick={() => onOpenDeliverable(item.id)} className={ROW}>
                  <span aria-hidden className={cn("h-8 w-0.5 shrink-0", ACCENT_BAR[accent])} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block font-mono text-[10px] font-semibold uppercase tracking-[0.2em]", ACCENT_TEXT[accent])}>
                      {item.agentId}
                    </span>
                    <span className="block truncate text-sm text-ink">{item.title}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[10px] uppercase leading-4 tracking-[0.15em] text-mute">
                    <span className="block tabular-nums">{formatNumber(item.words)} words</span>
                    <span className="hidden sm:block">{when(item.createdAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
