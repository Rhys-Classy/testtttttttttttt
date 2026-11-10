"use client";

import { FileText, OctagonX, Zap } from "lucide-react";
import { cn } from "../lib/cn";
import { formatDuration } from "../lib/format";
import type { Mode } from "../lib/types";
import { useClock } from "../lib/use-clock";
import { GlitchText } from "./GlitchText";

interface HeaderProps {
  live: number;
  total: number;
  /** Seconds since boot. */
  uptime: number;
  mode: Mode;
  /** Live: true when the crew has not been told who it works for. */
  needsBrief: boolean;
  onDeployAll: () => void;
  onRecallAll: () => void;
  onBrief: () => void;
}

const MODE: Record<Mode, { label: string; tone: string }> = {
  sim: { label: "SIMULATION", tone: "border-line text-mute" },
  linking: { label: "LINKING", tone: "border-line text-mute" },
  live: { label: "CLAUDE_UPLINK", tone: "border-cyan/60 text-cyan" },
};

const BUTTON =
  "flex h-9 items-center gap-2 rounded-none border px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-75";

function systemMode(live: number, total: number) {
  if (live === 0) return { label: "DORMANT", tone: "border-line text-mute", dot: "bg-mute" };
  if (live === total) {
    return { label: "OVERDRIVE", tone: "border-pink/60 text-pink", dot: "bg-pink animate-pulse-dot" };
  }
  return { label: "ONLINE", tone: "border-acid/50 text-acid", dot: "bg-acid animate-pulse-dot" };
}

export function Header({
  live,
  total,
  uptime,
  mode,
  needsBrief,
  onDeployAll,
  onRecallAll,
  onBrief,
}: HeaderProps) {
  const clock = useClock();
  const system = systemMode(live, total);

  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-void">
      <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-3 md:px-6">
        <span
          aria-hidden
          className="hidden size-9 shrink-0 place-items-center border border-pink bg-pink/10 font-mono text-sm font-bold text-pink sm:grid"
        >
          S/
        </span>
        <div className="min-w-0">
          <h1 className="font-mono text-lg font-bold leading-none tracking-tight md:text-xl">
            <GlitchText ambient>
              SYNDICATE<span className="text-pink">.OS</span>
            </GlitchText>
          </h1>
          <p className="mt-1.5 hidden font-mono text-[10px] uppercase leading-none tracking-[0.25em] text-mute sm:block">
            Operative control <span aria-hidden>{"//"}</span> build 3.0
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <dl className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.15em] 2xl:flex">
            <div className="flex gap-2">
              <dt className="text-mute">Nodes</dt>
              <dd className="tabular-nums">
                {live}/{total}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-mute">Uptime</dt>
              <dd className="tabular-nums">{formatDuration(uptime)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-mute">Local</dt>
              <dd className="tabular-nums">{clock}</dd>
            </div>
          </dl>

          {/* Whether the work on screen is real or scripted. */}
          <p
            className={cn(
              "hidden h-9 items-center border px-2.5 font-mono text-[11px] font-semibold tracking-[0.2em] lg:flex",
              MODE[mode].tone,
            )}
          >
            {MODE[mode].label}
          </p>

          <p
            role="status"
            className={cn(
              "flex h-9 items-center gap-2 border px-2.5 font-mono text-[11px] font-semibold tracking-[0.2em]",
              system.tone,
            )}
          >
            <span aria-hidden className={cn("size-1.5", system.dot)} />
            {/* On a phone the dot carries it; the words stay for screen readers. */}
            <span className="sr-only sm:not-sr-only">SYS_{system.label}</span>
          </p>

          {mode === "live" && (
            <button
              type="button"
              onClick={onBrief}
              aria-label={needsBrief ? "Set the business brief" : "Edit the business brief"}
              className={cn(
                BUTTON,
                needsBrief
                  ? "animate-pulse-dot border-cyan bg-cyan text-void hover:bg-transparent hover:text-cyan"
                  : "border-cyan text-cyan hover:bg-cyan hover:text-void",
              )}
            >
              <FileText aria-hidden className="size-3.5" />
              <span className="hidden md:inline">{needsBrief ? "Set brief" : "Brief"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onDeployAll}
            aria-label="Deploy all operatives"
            className={cn(BUTTON, "border-acid text-acid hover:bg-acid hover:text-void")}
          >
            <Zap aria-hidden className="size-3.5" fill="currentColor" />
            <span className="hidden md:inline">Deploy all</span>
          </button>
          <button
            type="button"
            onClick={onRecallAll}
            aria-label="Kill switch: recall all operatives"
            className={cn(BUTTON, "border-pink text-pink hover:bg-pink hover:text-void")}
          >
            <OctagonX aria-hidden className="size-3.5" />
            <span className="hidden md:inline">Kill switch</span>
          </button>
        </div>
      </div>
    </header>
  );
}
