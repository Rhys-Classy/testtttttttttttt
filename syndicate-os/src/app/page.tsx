"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCard } from "../components/AgentCard";
import { BootOverlay } from "../components/BootOverlay";
import { BriefPanel } from "../components/BriefPanel";
import { ConfigPanel } from "../components/ConfigPanel";
import { DeliverablePanel, type ReaderView } from "../components/DeliverablePanel";
import { Header } from "../components/Header";
import { StatStrip } from "../components/StatStrip";
import { TerminalLog } from "../components/TerminalLog";
import { Vault } from "../components/Vault";
import { statTiles } from "../lib/engine";
import { formatNumber } from "../lib/format";
import { briefReady } from "../lib/live";
import { AGENT_IDS } from "../lib/mock-data";
import type { AgentId, SyndicateState } from "../lib/types";
import { useSyndicate } from "../lib/use-syndicate";

/** The one drawer that can be open. */
type Panel =
  | { kind: "config"; id: AgentId }
  | { kind: "brief" }
  | { kind: "deliverable"; id: string }
  /** Whatever this operative is writing now, or the last thing it finished. */
  | { kind: "output"; id: AgentId }
  | null;

function finishedAt(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Work out what the reader drawer should show for the open panel, if anything. */
function readerView(panel: Panel, state: SyndicateState): ReaderView | null {
  if (panel?.kind !== "deliverable" && panel?.kind !== "output") return null;

  if (panel.kind === "output") {
    const agent = state.agents.find((candidate) => candidate.id === panel.id);
    if (agent?.status === "active") {
      return {
        agentId: agent.id,
        title: agent.task,
        body: agent.draft,
        meta: agent.draft ? "writing now" : "thinking",
        writing: true,
        truncated: false,
        deliverableId: null,
      };
    }
  }

  // A finished piece: the one asked for, or this operative's most recent.
  const item =
    panel.kind === "deliverable"
      ? state.deliverables.find((candidate) => candidate.id === panel.id)
      : state.deliverables.find((candidate) => candidate.agentId === panel.id);
  if (!item) return null;
  return {
    agentId: item.agentId,
    title: item.title,
    body: item.body,
    meta: `${formatNumber(item.words)} words, ${finishedAt(item.createdAt)}`,
    writing: false,
    truncated: item.truncated,
    deliverableId: item.id,
  };
}

export default function Home() {
  const { state, actions } = useSyndicate();
  const [panel, setPanel] = useState<Panel>(null);
  const promptRef = useRef<HTMLInputElement>(null);

  const live = state.mode === "live";
  const needsBrief = live && !briefReady(state.brief);
  const working = state.agents.filter((agent) => agent.status === "active").length;
  const configAgent =
    panel?.kind === "config"
      ? (state.agents.find((agent) => agent.id === panel.id) ?? null)
      : null;
  const reader = readerView(panel, state);
  const panelOpen = panel !== null;

  /** What each operative has in the vault: how many pieces, how long, and the newest title. */
  const vaultByAgent = useMemo(() => {
    const totals = new Map<AgentId, { count: number; words: number; last: string }>();
    for (const item of state.deliverables) {
      const entry = totals.get(item.agentId);
      // Newest first, so the first piece seen for an operative is its latest.
      if (entry) {
        entry.count += 1;
        entry.words += item.words;
      } else {
        totals.set(item.agentId, { count: 1, words: item.words, last: item.title });
      }
    }
    return totals;
  }, [state.deliverables]);

  const closePanel = useCallback(() => setPanel(null), []);
  const openConfig = useCallback((id: AgentId) => setPanel({ kind: "config", id }), []);
  const openOutput = useCallback((id: AgentId) => setPanel({ kind: "output", id }), []);
  const openDeliverable = useCallback((id: string) => setPanel({ kind: "deliverable", id }), []);
  const openBrief = useCallback(() => setPanel({ kind: "brief" }), []);

  const { toggleDeploy, deployAll } = actions;
  // With no brief on file there is nothing to write about, so ask for one first.
  const deploy = useCallback(
    (id: AgentId) => {
      toggleDeploy(id);
      if (needsBrief) setPanel({ kind: "brief" });
    },
    [toggleDeploy, needsBrief],
  );
  const deployEveryone = useCallback(() => {
    deployAll();
    if (needsBrief) setPanel({ kind: "brief" });
  }, [deployAll, needsBrief]);

  // Global shortcuts: 1–4 toggle an operative, / jumps to the command line.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (panelOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        promptRef.current?.focus();
      } else if (/^[1-4]$/.test(event.key)) {
        deploy(AGENT_IDS[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deploy, panelOpen]);

  return (
    // Full height comes from html and body, not the viewport unit, so the deck
    // also fits when it is hosted inside a padded or framed page.
    <div className="crt-scanline h-full">
      <div className="flex h-full flex-col overflow-hidden bg-void text-ink">
        <Header
          live={working}
          total={state.agents.length}
          uptime={state.uptime}
          mode={state.mode}
          needsBrief={needsBrief}
          onDeployAll={deployEveryone}
          onRecallAll={actions.recallAll}
          onBrief={openBrief}
        />

        <main className="grid-floor flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-[1680px] space-y-4 p-4 md:p-6">
            <StatStrip tiles={statTiles(state)} />

            <section aria-label="Operatives">
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {state.agents.map((agent, index) => {
                  const filed = vaultByAgent.get(agent.id);
                  return (
                    <li key={agent.id}>
                      <AgentCard
                        agent={agent}
                        mode={state.mode}
                        hotkey={index + 1}
                        delivered={filed?.count ?? 0}
                        wordsWritten={filed?.words ?? 0}
                        lastTitle={filed?.last ?? null}
                        onDeploy={deploy}
                        onConfigure={openConfig}
                        onOutput={openOutput}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>

            <Vault
              mode={state.mode}
              deliverables={state.deliverables}
              agents={state.agents}
              note={state.vaultNote}
              onOpenDeliverable={openDeliverable}
              onOpenLive={openOutput}
            />

            <p className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-mute lg:block">
              Keys <span aria-hidden>{"//"}</span> <kbd className="text-ink">1</kbd>–
              <kbd className="text-ink">4</kbd> deploy or recall <span aria-hidden>{"//"}</span>{" "}
              <kbd className="text-ink">/</kbd> command line <span aria-hidden>{"//"}</span>{" "}
              <kbd className="text-ink">Tab</kbd> autocomplete <span aria-hidden>{"//"}</span>{" "}
              <kbd className="text-ink">↑</kbd> history
            </p>
          </div>
        </main>

        <TerminalLog
          entries={state.log}
          onCommand={actions.command}
          onClear={actions.clearLog}
          inputRef={promptRef}
        />
      </div>

      <ConfigPanel
        agent={configAgent}
        mode={state.mode}
        onClose={closePanel}
        onStatus={actions.setStatus}
        onPatch={actions.patchConfig}
        onAssign={actions.assign}
      />
      <BriefPanel
        open={panel?.kind === "brief"}
        brief={state.brief}
        onSave={actions.saveBrief}
        onClose={closePanel}
      />
      <DeliverablePanel view={reader} onClose={closePanel} onDelete={actions.removeDeliverable} />
      <BootOverlay />
      <div aria-hidden className="crt-vignette" />
    </div>
  );
}
