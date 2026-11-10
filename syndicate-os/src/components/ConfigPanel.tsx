"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, X } from "lucide-react";
import { cn } from "../lib/cn";
import { CLOCK_RATE, currentDirective, upcomingDirectives } from "../lib/engine";
import { ACCENTS, PROFILES } from "../lib/mock-data";
import type { Agent, AgentConfig, AgentId, AgentStatus, ClockSpeed, Verbosity } from "../lib/types";

interface ConfigPanelProps {
  /** The operative being configured. Null closes the panel. */
  agent: Agent | null;
  onClose: () => void;
  onStatus: (id: AgentId, status: AgentStatus) => void;
  onPatch: (id: AgentId, patch: Partial<AgentConfig>) => void;
  onAssign: (id: AgentId, text: string) => void;
}

const STATUSES: readonly { value: AgentStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "offline", label: "Offline" },
];

const VERBOSITIES: readonly Verbosity[] = ["quiet", "normal", "loud"];
const CLOCKS: readonly ClockSpeed[] = [1, 2, 3, 4, 5];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent">
        {title}
      </h3>
      {hint && <p className="mt-1 text-xs leading-5 text-mute">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-px bg-line p-px">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-10 rounded-none font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-75",
            option.value === value
              ? "bg-accent text-void"
              : "bg-panel text-mute hover:bg-raised hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PanelBody({ agent, onClose, onStatus, onPatch, onAssign }: ConfigPanelProps & { agent: Agent }) {
  const profile = PROFILES[agent.id];
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [directive, setDirective] = useState("");

  // Take focus on open, hand it back to whatever opened the panel on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    // Keep Tab inside the panel while it is open.
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const transmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!directive.trim()) return;
    onAssign(agent.id, directive);
    setDirective("");
  };

  const now = currentDirective(agent);
  const queue = upcomingDirectives(agent, 4);
  const secondsPerDirective = Math.round(100 / CLOCK_RATE[agent.config.clock]);

  return (
    <motion.aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="config-title"
      onKeyDown={handleKeyDown}
      style={{ "--accent": ACCENTS[profile.accent].hex } as CSSProperties}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      // The env() padding keeps the header and footer clear of a phone's system bars.
      className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-accent bg-panel pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] shadow-[-28px_0_70px_-30px_var(--accent)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
            Configure <span aria-hidden>{"//"}</span> {profile.unit} <span aria-hidden>{"//"}</span>{" "}
            {profile.role}
          </p>
          <h2 id="config-title" className="mt-1 font-mono text-2xl font-bold tracking-tight text-accent">
            {agent.id}
          </h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close configuration"
          className="grid size-9 shrink-0 place-items-center rounded-none border border-line text-mute transition-colors duration-75 hover:border-accent hover:text-accent"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <Section title="Power_state">
          <Segmented
            label="Power state"
            options={STATUSES}
            value={agent.status}
            onChange={(status) => onStatus(agent.id, status)}
          />
        </Section>

        <Section title="Clock_speed" hint="How hard this operative runs. Faster burns through the queue sooner.">
          <div className="flex items-center gap-4">
            <input
              type="range"
              className="syn-range"
              min={1}
              max={5}
              step={1}
              value={agent.config.clock}
              aria-label="Clock speed"
              aria-valuetext={`times ${agent.config.clock}, about ${secondsPerDirective} seconds per directive`}
              onChange={(event) =>
                onPatch(agent.id, { clock: Number(event.target.value) as ClockSpeed })
              }
            />
            <output className="w-10 shrink-0 text-right font-mono text-xl font-bold tabular-nums text-accent">
              x{agent.config.clock}
            </output>
          </div>
          <div aria-hidden className="mr-14 flex justify-between font-mono text-[10px] text-mute">
            {CLOCKS.map((clock) => (
              <span key={clock} className={clock === agent.config.clock ? "text-ink" : undefined}>
                {clock}
              </span>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-mute">
            ~{secondsPerDirective}s per directive at this speed
          </p>
        </Section>

        <Section title="Verbosity" hint="How much this operative reports to the feed while it works.">
          <Segmented
            label="Verbosity"
            options={VERBOSITIES.map((value) => ({ value, label: value }))}
            value={agent.config.verbosity}
            onChange={(verbosity) => onPatch(agent.id, { verbosity })}
          />
        </Section>

        <Section
          title="Auto_requeue"
          hint="On: pulls the next directive the moment one lands. Off: goes idle and waits for you."
        >
          <button
            type="button"
            role="switch"
            aria-checked={agent.config.autoRequeue}
            aria-label="Auto requeue"
            onClick={() => onPatch(agent.id, { autoRequeue: !agent.config.autoRequeue })}
            className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em]"
          >
            <span
              className={cn(
                "flex h-6 w-11 items-center border p-0.5 transition-colors duration-75",
                agent.config.autoRequeue ? "justify-end border-accent bg-accent/15" : "justify-start border-line",
              )}
            >
              <span
                className={cn("block size-4", agent.config.autoRequeue ? "bg-accent" : "bg-mute")}
              />
            </span>
            <span className={agent.config.autoRequeue ? "text-accent" : "text-mute"}>
              {agent.config.autoRequeue ? "Engaged" : "Disengaged"}
            </span>
          </button>
        </Section>

        <Section
          title="Inject_directive"
          hint="Jumps the queue and deploys immediately. The interrupted directive restarts afterwards."
        >
          <form onSubmit={transmit} className="flex gap-2">
            <label htmlFor="config-directive" className="sr-only">
              New directive for {agent.id}
            </label>
            <input
              id="config-directive"
              value={directive}
              onChange={(event) => setDirective(event.target.value)}
              placeholder="e.g. Chase invoice 0931"
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-none border border-line bg-void px-3 font-mono text-base text-ink outline-none placeholder:text-mute/60 focus:border-accent md:text-[13px]"
            />
            <button
              type="submit"
              disabled={!directive.trim()}
              className="flex h-10 shrink-0 items-center gap-2 rounded-none border border-accent bg-accent px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-void transition-colors duration-75 hover:bg-transparent hover:text-accent disabled:border-line disabled:bg-transparent disabled:text-mute"
            >
              <Send aria-hidden className="size-3.5" />
              Transmit
            </button>
          </form>
        </Section>

        <Section title="Directive_queue">
          <ol className="space-y-2 font-mono text-xs leading-5">
            <li className="flex gap-3 text-ink">
              <span className="w-8 shrink-0 text-accent">NOW</span>
              <span>{now.text}</span>
            </li>
            {queue.map((item, index) => (
              <li key={`${index}-${item.text}`} className="flex gap-3 text-mute">
                <span className="w-8 shrink-0 tabular-nums">+{index + 1}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
          Changes are live <span aria-hidden>{"//"}</span> logged to feed
        </p>
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-none border border-line px-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink transition-colors duration-75 hover:border-accent hover:text-accent"
        >
          Done
        </button>
      </footer>
    </motion.aside>
  );
}

/** Slide-out control surface for one operative. Every control acts instantly. */
export function ConfigPanel(props: ConfigPanelProps) {
  const { agent, onClose } = props;
  return (
    <AnimatePresence>
      {agent && (
        <div key="config" className="fixed inset-0 z-50">
          <motion.div
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-void/75 backdrop-blur-[2px]"
          />
          <PanelBody {...props} agent={agent} />
        </div>
      )}
    </AnimatePresence>
  );
}
