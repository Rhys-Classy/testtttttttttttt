export type AgentId = "HYPE_BEAST" | "THE_SHADOW" | "THE_FIXER" | "THE_BANKER";

export type AgentStatus = "active" | "idle" | "offline";

export type AccentKey = "pink" | "cyan" | "acid";

export type Verbosity = "quiet" | "normal" | "loud";

/** Clock speed: 1 = slow and careful, 5 = redlining. */
export type ClockSpeed = 1 | 2 | 3 | 4 | 5;

export interface Directive {
  /** What the operative is doing, shown in the CURRENT_DIRECTIVE block. */
  text: string;
  /** Log line written when the directive completes. */
  done: string;
  /** How much the operative's headline metric moves on completion. */
  gain: number;
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
  /** Hours of human work one completed directive stands in for. */
  hoursPerDirective: number;
  playbook: readonly Directive[];
  chatter: readonly string[];
  idleTask: string;
  offlineTask: string;
}

/** Live state of an operative. */
export interface Agent {
  id: AgentId;
  status: AgentStatus;
  /** Text shown in the CURRENT_DIRECTIVE block right now. */
  task: string;
  /** Position in the playbook. */
  directiveIndex: number;
  /** An operator-injected directive that jumps the queue. */
  override: Directive | null;
  /** 0–100 on the directive in hand. Kept while idle so a redeploy resumes. */
  progress: number;
  completed: number;
  metric: number;
  /** Recent work rate, newest last. Drives the sparkline. */
  throughput: number[];
  config: AgentConfig;
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
}

/** Three random numbers in [0, 1) per operative, rolled outside the reducer. */
export type Rolls = Record<AgentId, readonly [number, number, number]>;

export type SyndicateAction =
  | { type: "BOOT"; ts: string }
  | { type: "TICK"; ts: string; rolls: Rolls }
  | { type: "TOGGLE_DEPLOY"; id: AgentId; ts: string }
  | { type: "SET_STATUS"; id: AgentId; status: AgentStatus; ts: string }
  | { type: "SET_ALL"; status: "active" | "idle"; ts: string }
  | { type: "PATCH_CONFIG"; id: AgentId; patch: Partial<AgentConfig>; ts: string }
  | { type: "ASSIGN"; id: AgentId; text: string; ts: string }
  | { type: "COMMAND"; raw: string; ts: string }
  | { type: "CLEAR_LOG"; ts: string };
