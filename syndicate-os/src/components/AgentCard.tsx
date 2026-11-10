"use client";

import { memo, type CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  Landmark,
  Megaphone,
  Play,
  Radar,
  Settings2,
  Square,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { MAX_STEP, upcomingDirectives } from "../lib/engine";
import { formatNumber } from "../lib/format";
import { ACCENTS, PROFILES } from "../lib/mock-data";
import type { Agent, AgentId, AgentStatus } from "../lib/types";
import { useTypewriter } from "../lib/use-typewriter";
import { GlitchText } from "./GlitchText";
import { Sparkline } from "./Sparkline";

interface AgentCardProps {
  agent: Agent;
  /** Number key that toggles this operative. */
  hotkey: number;
  onDeploy: (id: AgentId) => void;
  onConfigure: (id: AgentId) => void;
}

const ICONS: Record<AgentId, LucideIcon> = {
  HYPE_BEAST: Megaphone,
  THE_SHADOW: Radar,
  THE_FIXER: Wrench,
  THE_BANKER: Landmark,
};

const STATUS: Record<AgentStatus, { label: string; badge: string; dot: string }> = {
  active: {
    label: "ACTIVE",
    badge: "border-acid/50 bg-acid/10 text-acid",
    dot: "bg-acid text-acid animate-pulse-dot",
  },
  idle: {
    label: "IDLE",
    badge: "border-ink/30 text-ink/85",
    dot: "border border-ink/80",
  },
  offline: {
    label: "OFFLINE",
    badge: "border-line text-mute",
    dot: "bg-mute/50",
  },
};

const SEGMENTS = 24;

function StatusBadge({ status }: { status: AgentStatus }) {
  const { label, badge, dot } = STATUS[status];
  return (
    // Keyed by status so the badge remounts, and glitches, on every change.
    <span
      key={status}
      className={cn(
        "inline-flex animate-glitch items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em]",
        badge,
      )}
    >
      <span aria-hidden className={cn("size-1.5", dot)} />
      {label}
    </span>
  );
}

function SegmentBar({ value, active, label }: { value: number; active: boolean; label: string }) {
  const filled = Math.round((value / 100) * SEGMENTS);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="mt-3 flex gap-[2px]"
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 flex-1 bg-line",
            index < filled && (active ? "bg-accent" : "bg-accent/40"),
            active && index === filled && "animate-blink bg-accent/60",
          )}
        />
      ))}
    </div>
  );
}

function AgentCardBase({ agent, hotkey, onDeploy, onConfigure }: AgentCardProps) {
  const profile = PROFILES[agent.id];
  const Icon = ICONS[agent.id];
  const active = agent.status === "active";
  const offline = agent.status === "offline";
  const percent = Math.min(100, Math.floor(agent.progress));
  const typed = useTypewriter(agent.task);
  const [next] = upcomingDirectives(agent, 1);
  const titleId = `${agent.id}-name`;

  return (
    <motion.article
      aria-labelledby={titleId}
      data-status={agent.status}
      style={{ "--accent": ACCENTS[profile.accent].hex } as CSSProperties}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={cn(
        "relative flex h-full flex-col rounded-none border border-accent bg-panel p-4 transition-shadow duration-150",
        "hover:shadow-[0_0_0_1px_var(--accent),0_0_38px_-8px_var(--accent)]",
        "focus-within:shadow-[0_0_0_1px_var(--accent),0_0_38px_-8px_var(--accent)]",
        active && "shadow-[0_0_26px_-14px_var(--accent)]",
        offline && "border-accent/45",
      )}
    >
      {/* Heavy corners, like a targeting bracket. */}
      <span aria-hidden className="absolute -left-px -top-px size-2.5 border-l-2 border-t-2 border-accent" />
      <span aria-hidden className="absolute -bottom-px -right-px size-2.5 border-b-2 border-r-2 border-accent" />

      {/* A highlight runs along the top edge while the operative is working. */}
      {active && (
        <span aria-hidden className="absolute inset-x-0 -top-px h-px overflow-hidden">
          <span className="block h-full w-1/3 animate-sweep bg-linear-to-r from-transparent via-ink to-transparent" />
        </span>
      )}

      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
        <span className="text-mute">
          {profile.unit} <span aria-hidden>{"//"}</span>{" "}
          <span className={offline ? "text-accent/70" : "text-accent"}>{profile.role}</span>
        </span>
        <StatusBadge status={agent.status} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center border border-accent/60 bg-accent/10 text-accent",
            offline && "opacity-50",
          )}
        >
          <Icon aria-hidden className="size-5" strokeWidth={1.75} />
        </span>
        <h2
          id={titleId}
          className={cn(
            "font-mono text-xl font-bold tracking-tight",
            offline ? "text-ink/60" : "text-ink",
          )}
        >
          <GlitchText trigger={agent.status}>{agent.id}</GlitchText>
        </h2>
      </div>

      <div className={cn("mt-4 border border-line bg-void p-3", offline && "hatch")}>
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
          <span className={offline ? "text-accent/70" : "text-accent"}>CURRENT_DIRECTIVE</span>
          <span className="tabular-nums text-mute">
            {active || percent > 0 ? `${String(percent).padStart(2, "0")}%` : "--"}
          </span>
        </div>
        <p
          className={cn(
            "mt-2 min-h-[3.75rem] font-mono text-[13px] leading-5",
            offline ? "text-ink/60" : "text-ink",
          )}
        >
          <span aria-hidden className="mr-1.5 text-accent">
            &gt;
          </span>
          <span aria-hidden>{typed}</span>
          <span className="sr-only">{agent.task}</span>
          {active && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-blink bg-accent"
            />
          )}
        </p>
        <SegmentBar value={percent} active={active} label={`${agent.id} directive progress`} />
      </div>

      <div className="mt-4 flex items-end gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-3 font-mono">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-mute">{profile.metricLabel}</dt>
            <dd className="text-lg font-semibold tabular-nums leading-tight">
              {formatNumber(agent.metric)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-mute">DIRECTIVES</dt>
            <dd className="text-lg font-semibold tabular-nums leading-tight">{agent.completed}</dd>
          </div>
        </dl>
        <Sparkline
          values={agent.throughput}
          max={MAX_STEP}
          className={cn("h-8 w-20 shrink-0 text-accent", !active && "opacity-50")}
        />
      </div>

      <p className="mt-3 truncate border-t border-line pt-3 font-mono text-[11px] text-mute">
        <span className="text-ink/70">NEXT_UP</span> <span aria-hidden>&rsaquo;</span> {next.text}
      </p>

      <div className="mt-auto flex gap-2 pt-4">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => onDeploy(agent.id)}
          aria-label={`${active ? "Recall" : "Deploy"} ${agent.id}`}
          aria-keyshortcuts={String(hotkey)}
          className={cn(
            "flex h-11 flex-1 items-center justify-center gap-2 rounded-none border border-accent font-mono text-xs font-bold uppercase tracking-[0.2em] transition-colors duration-75",
            active
              ? "bg-transparent text-accent hover:bg-accent hover:text-void"
              : "bg-accent text-void hover:bg-transparent hover:text-accent",
          )}
        >
          {active ? (
            <Square aria-hidden className="size-3" fill="currentColor" />
          ) : (
            <Play aria-hidden className="size-3" fill="currentColor" />
          )}
          <span>{active ? "Recall" : "Deploy"}</span>
          <kbd className="hidden border border-current/40 px-1 font-mono text-[9px] font-normal tracking-normal lg:inline">
            {hotkey}
          </kbd>
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => onConfigure(agent.id)}
          aria-label={`Configure ${agent.id}`}
          className="flex h-11 items-center justify-center gap-2 rounded-none border border-line px-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-ink transition-colors duration-75 hover:border-accent hover:text-accent"
        >
          <Settings2 aria-hidden className="size-3.5" />
          <span>Configure</span>
        </motion.button>
      </div>
    </motion.article>
  );
}

/** Memoised: the engine keeps untouched operatives referentially equal between ticks. */
export const AgentCard = memo(AgentCardBase);
