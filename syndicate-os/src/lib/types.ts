export type AgentId = "HYPE_BEAST" | "THE_SHADOW" | "THE_FIXER" | "THE_BANKER";

export type AgentStatus = "active" | "idle" | "offline";

export type AccentKey = "pink" | "cyan" | "acid";

export type Verbosity = "quiet" | "normal" | "loud";

/** Clock speed: 1 = slow and careful, 5 = redlining. Simulation only. */
export type ClockSpeed = 1 | 2 | 3 | 4 | 5;

/**
 * sim      scripted demo: nothing is connected, the work is pretend
 * linking  the page is asking its host for a connection to Claude
 * live     operatives send each job to Claude and file what comes back
 */
export type Mode = "sim" | "linking" | "live";

export interface Directive {
  /** What the operative is doing, shown in the CURRENT_DIRECTIVE block. */
  text: string;
  /** Simulation: log line written when the directive completes. */
  done: string;
  /** Simulation: how much the operative's headline metric moves on completion. */
  gain: number;
  /** Live: the full instruction handed to Claude. */
  task?: string;
  /** Live: rough word ceiling for the finished piece. */
  words?: number;
}

export interface AgentConfig {
  clock: ClockSpeed;
  verbosity: Verbosity;
  /** Pull the next directive automatically when one completes. */
  autoRequeue: boolean;
}

/** Static definition of an operative: who they are and what they know how to do. */
export interface AgentProfile {
  id: AgentId;
  unit: string;
  role: string;
  accent: AccentKey;
  metricLabel: string;
  /** Hours of human work one finished job stands in for. A rough estimate. */
  hoursPerDirective: number;
  /** Simulation: scripted directives and the chatter that goes with them. */
  playbook: readonly Directive[];
  chatter: readonly string[];
  idleTask: string;
  offlineTask: string;
  /** Live: what this operative is for, in one line. Goes into its instructions. */
  remit: string;
  /** Live: the real jobs it works through. */
  jobs: readonly Directive[];
}

/** Live state of an operative. */
export interface Agent {
  id: AgentId;
  status: AgentStatus;
  /** Text shown in the CURRENT_DIRECTIVE block right now. */
  task: string;
  /** Position in the playbook (simulation) or the job list (live). */
  directiveIndex: number;
  /** An operator-injected directive that jumps the queue. */
  override: Directive | null;
  /** 0–100 on the directive in hand. */
  progress: number;
  /** Simulation: directives finished. */
  completed: number;
  /** Simulation: the headline metric. */
  metric: number;
  /** Recent work rate, newest last. Drives the sparkline. */
  throughput: number[];
  config: AgentConfig;
  /** Live: what Claude has written so far on the job in hand. */
  draft: string;
  /** Live: goes up each time a job starts, so a late reply to an old job can be ignored. */
  run: number;
  /** Live: length of the draft at the last tick, for the work-rate chart. */
  sampledChars: number;
}

/** Who the crew works for. The only facts a live operative is allowed to use. */
export interface BusinessBrief {
  name: string;
  offer: string;
  area: string;
  customer: string;
  edge: string;
  tone: string;
  facts: string;
}

/** One finished piece of real work. */
export interface Deliverable {
  id: string;
  agentId: AgentId;
  title: string;
  /** The job that produced it, as shown on the card. */
  directive: string;
  body: string;
  words: number;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** True when the answer hit the length limit and stops early. */
  truncated: boolean;
  /** False until the vault confirms it is stored. */
  saved: boolean;
}

export type LogSource = AgentId | "SYSTEM" | "OPERATOR";

export type LogLevel = "info" | "success" | "warn" | "error" | "input";

export interface LogEntry {
  id: number;
  /** HH:MM:SS, local time. */
  ts: string;
  source: LogSource;
  level: LogLevel;
  message: string;
}

export interface SyndicateState {
  agents: Agent[];
  log: LogEntry[];
  /** Next log entry id. */
  seq: number;
  /** Seconds since boot. */
  uptime: number;
  booted: boolean;
  mode: Mode;
  /** True once the host has answered about Claude, either way. */
  linkSettled: boolean;
  /** Why Claude cannot be used in this view, once it has refused. No further calls are made. */
  uplinkDenied: string | null;
  brief: BusinessBrief;
  /** Newest first. */
  deliverables: Deliverable[];
  /** True once the stored deliverables have arrived for the first time. */
  vaultLoaded: boolean;
  /** Plain-language warning about where work is being kept. Null when all is well. */
  vaultNote: string | null;
}

/** Three random numbers in [0, 1) per operative, rolled outside the reducer. */
export type Rolls = Record<AgentId, readonly [number, number, number]>;

export type SyndicateAction =
  | { type: "BOOT"; ts: string; hasHost: boolean }
  | { type: "TICK"; ts: string; rolls: Rolls }
  | { type: "TOGGLE_DEPLOY"; id: AgentId; ts: string }
  | { type: "SET_STATUS"; id: AgentId; status: AgentStatus; ts: string }
  | { type: "SET_ALL"; status: "active" | "idle"; ts: string }
  | { type: "PATCH_CONFIG"; id: AgentId; patch: Partial<AgentConfig>; ts: string }
  | { type: "ASSIGN"; id: AgentId; text: string; ts: string }
  | { type: "COMMAND"; raw: string; ts: string }
  | { type: "CLEAR_LOG"; ts: string }
  | { type: "GO_LIVE"; ts: string; persistent: boolean }
  | { type: "LINK_FAILED"; ts: string }
  | { type: "JOB_TEXT"; id: AgentId; run: number; text: string }
  | { type: "JOB_DONE"; id: AgentId; run: number; deliverable: Deliverable; ts: string }
  | { type: "JOB_FAILED"; id: AgentId; run: number; code: string; ts: string }
  | { type: "VAULT_SYNC"; deliverables: Deliverable[] }
  | { type: "VAULT_NOTE"; note: string | null }
  | { type: "DELIVERABLE_SAVED"; id: string }
  | { type: "DELIVERABLE_REMOVED"; id: string; ts: string }
  | { type: "BRIEF_SET"; brief: BusinessBrief; ts: string; announce: boolean };
