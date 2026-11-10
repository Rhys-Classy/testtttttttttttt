"use client";

import { OctagonX, Zap } from "lucide-react";
import { cn } from "../lib/cn";
import { formatDuration } from "../lib/format";
import { useClock } from "../lib/use-clock";
import { GlitchText } from "./GlitchText";

interface HeaderProps {
  live: number;
  total: number;
  /** Seconds since boot. */
  uptime: number;
  onDeployAll: () => void;
  onRecallAll: () => void;
}

function systemMode(live: number, total: number) {
  if (live === 0) return { label: "DORMANT", tone: "border-line text-mute", dot: "bg-mute" };
  if (live === total) {
    return { label: "OVERDRIVE", tone: "border-pink/60 text-pink", dot: "bg-pink animate-pulse-dot" };
  }
  return { label: "ONLINE", tone: "border-acid/50 text-acid", dot: "bg-acid animate-pulse-dot" };
}

export function Header({ live, total, uptime, onDeployAll, onRecallAll }: HeaderProps) {
  const clock = useClock();
  const mode = systemMode(live, total);

  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-void">
      <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-3 md:px-6">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center border border-pink bg-pink/10 font-mono text-sm font-bold text-pink"
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
            Operative control <span aria-hidden>{"//"}</span> build 2.6
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 md:gap-4">
          <dl className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.15em] xl:flex">
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

          <p
            role="status"
            className={cn(
              "flex h-9 items-center gap-2 border px-2.5 font-mono text-[11px] font-semibold tracking-[0.2em]",
              mode.tone,
            )}
          >
            <span aria-hidden className={cn("size-1.5", mode.dot)} />
            <span className="hidden sm:inline">SYS_</span>
            {mode.label}
          </p>

          <button
            type="button"
            onClick={onDeployAll}
            aria-label="Deploy all operatives"
            className="flex h-9 items-center gap-2 rounded-none border border-acid px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-acid transition-colors duration-75 hover:bg-acid hover:text-void"
          >
            <Zap aria-hidden className="size-3.5" fill="currentColor" />
            <span className="hidden md:inline">Deploy all</span>
          </button>
          <button
            type="button"
            onClick={onRecallAll}
            aria-label="Kill switch: recall all operatives"
            className="flex h-9 items-center gap-2 rounded-none border border-pink px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-pink transition-colors duration-75 hover:bg-pink hover:text-void"
          >
            <OctagonX aria-hidden className="size-3.5" />
            <span className="hidden md:inline">Kill switch</span>
          </button>
        </div>
      </div>
    </header>
  );
}
