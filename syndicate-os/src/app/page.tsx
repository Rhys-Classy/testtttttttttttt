"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCard } from "../components/AgentCard";
import { BootOverlay } from "../components/BootOverlay";
import { ConfigPanel } from "../components/ConfigPanel";
import { Header } from "../components/Header";
import { StatStrip } from "../components/StatStrip";
import { TerminalLog } from "../components/TerminalLog";
import { summarise } from "../lib/engine";
import { AGENT_IDS } from "../lib/mock-data";
import type { AgentId } from "../lib/types";
import { useSyndicate } from "../lib/use-syndicate";

export default function Home() {
  const { state, actions } = useSyndicate();
  const [configId, setConfigId] = useState<AgentId | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);

  const summary = summarise(state);
  const configAgent = state.agents.find((agent) => agent.id === configId) ?? null;
  const closeConfig = useCallback(() => setConfigId(null), []);

  // Global shortcuts: 1–4 toggle an operative, / jumps to the command line.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (configId || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        promptRef.current?.focus();
      } else if (/^[1-4]$/.test(event.key)) {
        actions.toggleDeploy(AGENT_IDS[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, configId]);

  return (
    <div className="crt-scanline">
      <div className="flex h-dvh flex-col overflow-hidden bg-void text-ink">
        <Header
          live={summary.live}
          total={summary.total}
          uptime={state.uptime}
          onDeployAll={actions.deployAll}
          onRecallAll={actions.recallAll}
        />

        <main className="grid-floor flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-[1680px] space-y-4 p-4 md:p-6">
            <StatStrip
              live={summary.live}
              total={summary.total}
              executed={summary.executed}
              leads={summary.leads}
              hours={summary.hours}
            />

            <section aria-label="Operatives">
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {state.agents.map((agent, index) => (
                  <li key={agent.id}>
                    <AgentCard
                      agent={agent}
                      hotkey={index + 1}
                      onDeploy={actions.toggleDeploy}
                      onConfigure={setConfigId}
                    />
                  </li>
                ))}
              </ul>
            </section>

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
        onClose={closeConfig}
        onStatus={actions.setStatus}
        onPatch={actions.patchConfig}
        onAssign={actions.assign}
      />
      <BootOverlay />
      <div aria-hidden className="crt-vignette" />
    </div>
  );
}
