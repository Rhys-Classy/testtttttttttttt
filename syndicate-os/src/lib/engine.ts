import { AGENT_IDS, INITIAL_AGENTS, PROFILES } from "./mock-data";
import type {
  Agent,
  AgentConfig,
  AgentId,
  AgentStatus,
  ClockSpeed,
  Directive,
  LogEntry,
  LogLevel,
  Rolls,
  SyndicateAction,
  SyndicateState,
  Verbosity,
} from "./types";

/**
 * The whole simulation is this one pure reducer. Clocks and dice live in the
 * hook that drives it; every action arrives carrying its own timestamp and
 * random rolls, so the same actions always produce the same state.
 */

const LOG_LIMIT = 400;
export const SPARK_POINTS = 24;

/** Average progress per one-second tick, in percent of a directive. */
export const CLOCK_RATE: Record<ClockSpeed, number> = { 1: 1.5, 2: 2.8, 3: 4.5, 4: 7, 5: 11 };

/** Highest value a single tick can add: top clock on its luckiest roll. */
export const MAX_STEP = CLOCK_RATE[5] * 1.5;

/** Chance per tick that a working operative says something in the feed. */
const CHATTER_CHANCE: Record<Verbosity, number> = { quiet: 0.05, normal: 0.18, loud: 0.42 };

const CONFIG_LABEL: Record<keyof AgentConfig, string> = {
  clock: "clock",
  verbosity: "verbosity",
  autoRequeue: "auto_requeue",
};

export const COMMANDS = [
  { name: "help", usage: "help", about: "list commands" },
  { name: "status", usage: "status", about: "report on every operative" },
  { name: "deploy", usage: "deploy <operative|all>", about: "put an operative to work" },
  { name: "recall", usage: "recall <operative|all>", about: "pull an operative back to idle" },
  { name: "boot", usage: "boot <operative|all>", about: "bring an offline node up to idle" },
  { name: "kill", usage: "kill <operative|all>", about: "take a node offline" },
  { name: "assign", usage: "assign <operative> <directive>", about: "inject a directive and deploy" },
  { name: "clock", usage: "clock <operative> <1-5>", about: "set clock speed" },
  { name: "clear", usage: "clear", about: "flush the feed" },
  { name: "whoami", usage: "whoami", about: "check your clearance" },
] as const;

type CommandName = (typeof COMMANDS)[number]["name"];

type Line = Pick<LogEntry, "source" | "level" | "message">;

export const INITIAL_STATE: SyndicateState = {
  agents: INITIAL_AGENTS,
  log: [],
  seq: 1,
  uptime: 0,
  booted: false,
};

const sys = (level: LogLevel, message: string): Line => ({ source: "SYSTEM", level, message });

/** The directive an operative is working on, or will pick up when deployed. */
export function currentDirective(agent: Agent): Directive {
  return agent.override ?? PROFILES[agent.id].playbook[agent.directiveIndex];
}

/** The next `count` directives after the current one. */
export function upcomingDirectives(agent: Agent, count: number): Directive[] {
  const { playbook } = PROFILES[agent.id];
  // An injected directive interrupts the playbook, so the interrupted one is next.
  const start = agent.override ? agent.directiveIndex : agent.directiveIndex + 1;
  return Array.from({ length: count }, (_, offset) => playbook[(start + offset) % playbook.length]);
}

/** Headline numbers for the stat strip. */
export function summarise(state: SyndicateState) {
  const live = state.agents.filter((agent) => agent.status === "active").length;
  const executed = state.agents.reduce((sum, agent) => sum + agent.completed, 0);
  const hours = state.agents.reduce(
    (sum, agent) => sum + agent.completed * PROFILES[agent.id].hoursPerDirective,
    0,
  );
  const leads = state.agents.find((agent) => agent.id === "THE_SHADOW")?.metric ?? 0;
  return { live, total: state.agents.length, executed, hours, leads };
}

function write(state: SyndicateState, ts: string, lines: readonly Line[]): SyndicateState {
  if (lines.length === 0) return state;
  const entries: LogEntry[] = lines.map((line, offset) => ({ ...line, ts, id: state.seq + offset }));
  return {
    ...state,
    seq: state.seq + lines.length,
    log: [...state.log, ...entries].slice(-LOG_LIMIT),
  };
}

function pushSample(series: readonly number[], value: number): number[] {
  return [...series.slice(-(SPARK_POINTS - 1)), value];
}

function transition(agent: Agent, status: AgentStatus): { agent: Agent; line: Line } {
  const profile = PROFILES[agent.id];
  if (agent.status === status) {
    return { agent, line: sys("warn", `${agent.id} is already ${status}`) };
  }
  if (status === "active") {
    const message =
      agent.status === "offline"
        ? "boot sequence complete. Deployed and hunting"
        : agent.progress > 0
          ? `redeployed. Resuming directive at ${Math.floor(agent.progress)}%`
          : "deployed. Initiated task sequence...";
    return {
      agent: { ...agent, status, task: currentDirective(agent).text },
      line: { source: agent.id, level: "success", message },
    };
  }
  if (status === "idle") {
    const message =
      agent.status === "offline" ? "booted. Standing by for orders" : "recalled. Standing by";
    return {
      agent: { ...agent, status, task: profile.idleTask },
      line: { source: agent.id, level: "warn", message },
    };
  }
  return {
    agent: { ...agent, status, task: profile.offlineTask },
    line: { source: agent.id, level: "error", message: "powered down. Node dark" },
  };
}

function setStatus(
  state: SyndicateState,
  ids: readonly AgentId[],
  status: AgentStatus,
  ts: string,
): SyndicateState {
  const lines: Line[] = [];
  const agents = state.agents.map((agent) => {
    if (!ids.includes(agent.id)) return agent;
    const result = transition(agent, status);
    lines.push(result.line);
    return result.agent;
  });
  return write({ ...state, agents }, ts, lines);
}

function tick(state: SyndicateState, ts: string, rolls: Rolls): SyndicateState {
  const lines: Line[] = [];
  const agents = state.agents.map((agent): Agent => {
    if (agent.status !== "active") {
      // Let the sparkline drain to flat, then leave the object alone so the card can skip rendering.
      return agent.throughput.some((value) => value > 0)
        ? { ...agent, throughput: pushSample(agent.throughput, 0) }
        : agent;
    }

    const profile = PROFILES[agent.id];
    const [pace, chatterRoll, pick] = rolls[agent.id];
    const step = CLOCK_RATE[agent.config.clock] * (0.5 + pace);
    const progress = agent.progress + step;
    const throughput = pushSample(agent.throughput, step);

    if (chatterRoll < CHATTER_CHANCE[agent.config.verbosity]) {
      const message = profile.chatter[Math.floor(pick * profile.chatter.length)];
      lines.push({ source: agent.id, level: "info", message });
    }
    if (progress < 100) return { ...agent, progress, throughput };

    const finished = currentDirective(agent);
    lines.push({ source: agent.id, level: "success", message: finished.done });
    const directiveIndex = agent.override
      ? agent.directiveIndex
      : (agent.directiveIndex + 1) % profile.playbook.length;
    const done: Agent = {
      ...agent,
      override: null,
      directiveIndex,
      progress: 0,
      completed: agent.completed + 1,
      metric: agent.metric + finished.gain,
      throughput,
    };
    if (agent.config.autoRequeue) return { ...done, task: profile.playbook[directiveIndex].text };

    lines.push({
      source: agent.id,
      level: "warn",
      message: "queue on hold. Auto-requeue is off, standing by",
    });
    return { ...done, status: "idle", task: profile.idleTask };
  });
  return write({ ...state, agents, uptime: state.uptime + 1 }, ts, lines);
}

function assign(state: SyndicateState, id: AgentId, raw: string, ts: string): SyndicateState {
  const text = raw.trim().slice(0, 120);
  if (!text) return state;
  const override: Directive = { text, done: "operator directive executed", gain: 1 };
  const agents = state.agents.map((agent): Agent =>
    agent.id === id ? { ...agent, status: "active", override, progress: 0, task: text } : agent,
  );
  return write({ ...state, agents }, ts, [
    { source: id, level: "success", message: `directive accepted: "${text}"` },
  ]);
}

function patchConfig(
  state: SyndicateState,
  id: AgentId,
  patch: Partial<AgentConfig>,
  ts: string,
): SyndicateState {
  const agents = state.agents.map((agent) =>
    agent.id === id ? { ...agent, config: { ...agent.config, ...patch } } : agent,
  );
  const summary = (Object.keys(patch) as (keyof AgentConfig)[])
    .map((key) => `${CONFIG_LABEL[key]}=${String(patch[key])}`)
    .join(" ");
  return write({ ...state, agents }, ts, [
    { source: "OPERATOR", level: "input", message: `patch ${id.toLowerCase()} ${summary}` },
  ]);
}

function boot(state: SyndicateState, ts: string): SyndicateState {
  if (state.booted) return state;
  const count = (status: AgentStatus) =>
    state.agents.filter((agent) => agent.status === status).length;
  return write({ ...state, booted: true }, ts, [
    sys("info", "SYNDICATE.OS v2.6 // kernel handshake OK"),
    sys(
      "info",
      `${state.agents.length} operatives registered: ${count("active")} live, ${count("idle")} idle, ${count("offline")} dark`,
    ),
    { source: "HYPE_BEAST", level: "info", message: "initiated task sequence..." },
    { source: "THE_SHADOW", level: "info", message: "secured 12 new emails" },
    sys("success", "operator console ready. Type 'help' or press / to take the wheel"),
  ]);
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Turn "hype", "the_shadow", "3" or "all" into operative ids. Null when nothing fits. */
function resolveTargets(token: string | undefined): AgentId[] | null {
  if (!token) return null;
  const key = squash(token);
  if (key === "all") return [...AGENT_IDS];
  if (/^[1-4]$/.test(key)) return [AGENT_IDS[Number(key) - 1]];
  if (key.length < 2) return null;
  const matches = AGENT_IDS.filter((id) => squash(id).includes(key));
  return matches.length === 1 ? matches : null;
}

function runCommand(state: SyndicateState, raw: string, ts: string): SyndicateState {
  const input = raw.trim().slice(0, 200);
  if (!input) return state;

  const [head, ...args] = input.split(/\s+/);
  const echoed = write(state, ts, [{ source: "OPERATOR", level: "input", message: input }]);
  const reply = (...lines: Line[]) => write(echoed, ts, lines);
  const usage = (name: CommandName) =>
    reply(sys("error", `usage: ${COMMANDS.find((command) => command.name === name)?.usage}`));
  const noMatch = (token: string) =>
    reply(sys("error", `no single operative matches "${token}". Try: ${AGENT_IDS.join(", ").toLowerCase()}`));
  const statusOf = (id: AgentId) => echoed.agents.find((agent) => agent.id === id)?.status;

  /** Move the targets to `status`. With "all", only touch the ones `eligible` allows. */
  const move = (
    name: CommandName,
    status: AgentStatus,
    eligible: (current: AgentStatus | undefined) => boolean,
    nothingToDo: string,
  ) => {
    const ids = resolveTargets(args[0]);
    if (!ids) return args[0] ? noMatch(args[0]) : usage(name);
    const targets = ids.length > 1 ? ids.filter((id) => eligible(statusOf(id))) : ids;
    if (targets.length === 0) return reply(sys("warn", nothingToDo));
    return setStatus(echoed, targets, status, ts);
  };

  switch (head.toLowerCase()) {
    case "help":
    case "?":
      return reply(
        ...COMMANDS.map((command) => sys("info", `${command.usage.padEnd(32)}${command.about}`)),
        sys("info", "operatives answer to a name, a fragment or a number: hype, shadow, 3, banker"),
      );

    case "status":
    case "ls":
      return reply(
        ...echoed.agents.map((agent) =>
          sys(
            "info",
            [
              PROFILES[agent.id].unit,
              agent.id.padEnd(10),
              agent.status.toUpperCase().padEnd(7),
              `${String(Math.floor(agent.progress)).padStart(3)}%`,
              `clock x${agent.config.clock}`,
              `done ${agent.completed}`,
            ].join("  "),
          ),
        ),
      );

    case "deploy":
    case "run":
      return move("deploy", "active", (s) => s !== "active", "every operative is already deployed");

    case "recall":
    case "halt":
    case "stop":
      return move("recall", "idle", (s) => s === "active", "no operatives in the field");

    case "boot":
      return move("boot", "idle", (s) => s === "offline", "every node is already online");

    case "kill":
    case "offline":
      return move("kill", "offline", (s) => s !== "offline", "every node is already dark");

    case "assign": {
      const ids = resolveTargets(args[0]);
      const text = args.slice(1).join(" ");
      if (!args[0] || !text) return usage("assign");
      if (!ids || ids.length !== 1) return noMatch(args[0]);
      return assign(echoed, ids[0], text, ts);
    }

    case "clock":
    case "speed": {
      const ids = resolveTargets(args[0]);
      const speed = Number(args[1]);
      if (!args[0] || ![1, 2, 3, 4, 5].includes(speed)) return usage("clock");
      if (!ids || ids.length !== 1) return noMatch(args[0]);
      return patchConfig(echoed, ids[0], { clock: speed as ClockSpeed }, ts);
    }

    case "clear":
    case "cls":
      return write({ ...state, log: [] }, ts, [sys("info", "feed flushed")]);

    case "whoami":
      return reply(sys("info", "operator // clearance OMEGA // this session was never here"));

    default:
      return reply(sys("error", `unknown command "${head}". Type 'help'`));
  }
}

export function reducer(state: SyndicateState, action: SyndicateAction): SyndicateState {
  switch (action.type) {
    case "BOOT":
      return boot(state, action.ts);
    case "TICK":
      return tick(state, action.ts, action.rolls);
    case "TOGGLE_DEPLOY": {
      const agent = state.agents.find((candidate) => candidate.id === action.id);
      if (!agent) return state;
      return setStatus(state, [action.id], agent.status === "active" ? "idle" : "active", action.ts);
    }
    case "SET_STATUS":
      return setStatus(state, [action.id], action.status, action.ts);
    case "SET_ALL": {
      // Deploy-all wakes everything, dark nodes included. Recall-all only touches the field.
      const ids = state.agents
        .filter((agent) =>
          action.status === "active" ? agent.status !== "active" : agent.status === "active",
        )
        .map((agent) => agent.id);
      const order: Line = {
        source: "OPERATOR",
        level: "input",
        message: action.status === "active" ? "deploy all" : "recall all",
      };
      if (ids.length === 0) {
        const note =
          action.status === "active"
            ? "every operative is already deployed"
            : "no operatives in the field";
        return write(state, action.ts, [order, sys("warn", note)]);
      }
      return setStatus(write(state, action.ts, [order]), ids, action.status, action.ts);
    }
    case "PATCH_CONFIG":
      return patchConfig(state, action.id, action.patch, action.ts);
    case "ASSIGN":
      return assign(state, action.id, action.text, action.ts);
    case "COMMAND":
      return runCommand(state, action.raw, action.ts);
    case "CLEAR_LOG":
      return write({ ...state, log: [] }, action.ts, [sys("info", "feed flushed")]);
  }
}
