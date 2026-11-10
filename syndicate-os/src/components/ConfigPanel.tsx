"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "../lib/cn";
import { CLOCK_RATE, currentDirective, upcomingDirectives } from "../lib/engine";
import { ACCENTS, PROFILES } from "../lib/mock-data";
import type {
  Agent,
  AgentConfig,
  AgentId,
  AgentStatus,
  ClockSpeed,
  Mode,
  Verbosity,
} from "../lib/types";
import { Drawer, DrawerHeader, DrawerSection, drawerButton } from "./Drawer";

interface ConfigPanelProps {
  /** The operative being configured. Null closes the panel. */
  agent: Agent | null;
  mode: Mode;
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

function Controls({
  agent,
  mode,
  onClose,
  onStatus,
  onPatch,
  onAssign,
}: ConfigPanelProps & { agent: Agent }) {
  const profile = PROFILES[agent.id];
  const live = mode !== "sim";
  const [directive, setDirective] = useState("");

  const transmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!directive.trim()) return;
    onAssign(agent.id, directive);
    setDirective("");
  };

  const now = currentDirective(agent, mode);
  const queue = upcomingDirectives(agent, 4, mode);
  const secondsPerDirective = Math.round(100 / CLOCK_RATE[agent.config.clock]);

  return (
    <>
      <DrawerHeader
        titleId="config-title"
        eyebrow={
          <>
            Configure <span aria-hidden>{"//"}</span> {profile.unit} <span aria-hidden>{"//"}</span>{" "}
            {profile.role}
          </>
        }
        title={agent.id}
        closeLabel="Close configuration"
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <DrawerSection title="Power_state">
          <Segmented
            label="Power state"
            options={STATUSES}
            value={agent.status}
            onChange={(status) => onStatus(agent.id, status)}
          />
        </DrawerSection>

        {/* Clock and chatter only steer the pretend work. Real jobs take as long as they take. */}
        {!live && (
          <>
            <DrawerSection
              title="Clock_speed"
              hint="How hard this operative runs. Faster burns through the queue sooner."
            >
              <div className="flex items-center gap-4">
                <input
                  id="config-clock"
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
            </DrawerSection>

            <DrawerSection
              title="Verbosity"
              hint="How much this operative reports to the feed while it works."
            >
              <Segmented
                label="Verbosity"
                options={VERBOSITIES.map((value) => ({ value, label: value }))}
                value={agent.config.verbosity}
                onChange={(verbosity) => onPatch(agent.id, { verbosity })}
              />
            </DrawerSection>
          </>
        )}

        <DrawerSection
          title="Auto_requeue"
          hint={
            live
              ? "On: one deploy runs every job left on the list, back to back, then stops. Off: one deploy, one job. Each job uses some of your Claude allowance."
              : "On: pulls the next directive the moment one lands. Off: goes idle and waits for you."
          }
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
        </DrawerSection>

        <DrawerSection
          title="Inject_directive"
          hint={
            live
              ? "Type any job in plain words. This operative does it now and files the result in the vault."
              : "Jumps the queue and deploys immediately. The interrupted directive restarts afterwards."
          }
        >
          <form onSubmit={transmit} className="flex gap-2">
            <label htmlFor="config-directive" className="sr-only">
              New directive for {agent.id}
            </label>
            <input
              id="config-directive"
              value={directive}
              onChange={(event) => setDirective(event.target.value)}
              placeholder={live ? "e.g. Write 3 ads for our winter offer" : "e.g. Chase invoice 0931"}
              maxLength={240}
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-none border border-line bg-void px-3 font-mono text-base text-ink outline-none placeholder:text-mute/60 focus:border-accent md:text-[13px]"
            />
            <button type="submit" disabled={!directive.trim()} className={cn(drawerButton.solid, "h-10 shrink-0 px-3")}>
              <Send aria-hidden className="size-3.5" />
              Transmit
            </button>
          </form>
        </DrawerSection>

        <DrawerSection title={live ? "Job_list" : "Directive_queue"}>
          <ol className="space-y-2 font-mono text-xs leading-5">
            <li className="flex gap-3 text-ink">
              <span className="w-8 shrink-0 text-accent">{agent.status === "active" ? "NOW" : "NEXT"}</span>
              <span>{now.text}</span>
            </li>
            {queue.map((item, index) => (
              <li key={`${index}-${item.text}`} className="flex gap-3 text-mute">
                <span className="w-8 shrink-0 tabular-nums">+{index + 1}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        </DrawerSection>
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
          Changes are live <span aria-hidden>{"//"}</span> logged to feed
        </p>
        <button type="button" onClick={onClose} className={drawerButton.quiet}>
          Done
        </button>
      </footer>
    </>
  );
}

/** Slide-out control surface for one operative. Every control acts instantly. */
export function ConfigPanel(props: ConfigPanelProps) {
  const { agent, onClose } = props;
  const accent = agent ? ACCENTS[PROFILES[agent.id].accent].hex : ACCENTS.cyan.hex;
  return (
    <Drawer open={agent !== null} onClose={onClose} labelledBy="config-title" accent={accent}>
      {agent && <Controls {...props} agent={agent} />}
    </Drawer>
  );
}
