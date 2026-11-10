import { formatNumber } from "./format";
import { briefReady, expectedChars, explainFailure } from "./live";
import {
  AGENT_IDS,
  EMPTY_BRIEF,
  INITIAL_AGENTS,
  LIVE_AGENTS,
  LIVE_IDLE,
  LIVE_OFFLINE,
  PROFILES,
} from "./mock-data";
import type {
  Agent,
  AgentConfig,
  AgentId,
  AgentStatus,
  ClockSpeed,
  Deliverable,
  Directive,
  LogEntry,
  LogLevel,
  Mode,
  Rolls,
  SyndicateAction,
  SyndicateState,
  Verbosity,
} from "./types";

/**
 * The whole dashboard is this one pure reducer. Clocks, dice and calls to
 * Claude live in the hooks that drive it; every action arrives carrying its
 * own timestamp and results, so the same actions always produce the same state.
 *
 * It runs in two worlds. In the simulation, a tick advances pretend work. In
 * live mode nothing is pretend: a job only moves when Claude writes, and the
 * feed only reports things that happened.
 */

const LOG_LIMIT = 400;
export const SPARK_POINTS = 24;

/** Simulation: average progress per one-second tick, in percent of a directive. */
export const CLOCK_RATE: Record<ClockSpeed, number> = { 1: 1.5, 2: 2.8, 3: 4.5, 4: 7, 5: 11 };

/** Top of the work-rate chart: the fastest clock on its luckiest roll. */
export const MAX_STEP = CLOCK_RATE[5] * 1.5;

/** Simulation: chance per tick that a working operative says something in the feed. */
const CHATTER_CHANCE: Record<Verbosity, number> = { quiet: 0.05, normal: 0.18, loud: 0.42 };

/** Live: characters written in a second that fill the work-rate chart to the top. */
const CHARS_PER_STEP = 12;

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
  { name: "clock", usage: "clock <operative> <1-5>", about: "set clock speed (simulation)" },
  { name: "brief", usage: "brief", about: "show who the crew is working for" },
  { name: "clear", usage: "clear", about: "flush the feed" },
  { name: "whoami", usage: "whoami", about: "check your clearance" },
] as const;

type CommandName = (typeof COMMANDS)[number]["name"];

type Line = Pick<LogEntry, "source" | "level" | "message">;

export interface StatTile {
  label: string;
  value: string;
  note: string;
  tone: "acid" | "ink" | "cyan" | "pink";
}

export const INITIAL_STATE: SyndicateState = {
  agents: INITIAL_AGENTS,
  log: [],
  seq: 1,
  uptime: 0,
  booted: false,
  mode: "sim",
  linkSettled: false,
  engine: null,
  uplinkDenied: null,
  brief: EMPTY_BRIEF,
  deliverables: [],
  vaultLoaded: false,
  vaultNote: null,
};

const sys = (level: LogLevel, message: string): Line => ({ source: "SYSTEM", level, message });

/** The scripted playbook in the simulation, the real job list otherwise. */
function directivesFor(id: AgentId, mode: Mode): readonly Directive[] {
  return mode === "sim" ? PROFILES[id].playbook : PROFILES[id].jobs;
}

/** The directive an operative is working on, or will pick up when deployed. */
export function currentDirective(agent: Agent, mode: Mode): Directive {
  return agent.override ?? directivesFor(agent.id, mode)[agent.directiveIndex];
}

/** The next `count` directives after the current one. */
export function upcomingDirectives(agent: Agent, count: number, mode: Mode): Directive[] {
  const list = directivesFor(agent.id, mode);
  // An injected directive interrupts the list, so the interrupted one is next.
  const start = agent.override ? agent.directiveIndex : agent.directiveIndex + 1;
  return Array.from({ length: count }, (_, offset) => list[(start + offset) % list.length]);
}

/** The four headline numbers. Live mode counts only work that exists. */
export function statTiles(state: SyndicateState): StatTile[] {
  const live = state.agents.filter((agent) => agent.status === "active").length;
  const crew: StatTile = {
    label: "OPERATIVES_LIVE",
    value: `${live}/${state.agents.length}`,
    note: state.mode === "sim" ? "in the field right now" : "working right now",
    tone: "acid",
  };

  if (state.mode === "sim") {
    const executed = state.agents.reduce((sum, agent) => sum + agent.completed, 0);
    const hours = state.agents.reduce(
      (sum, agent) => sum + agent.completed * PROFILES[agent.id].hoursPerDirective,
      0,
    );
    const leads = state.agents.find((agent) => agent.id === "THE_SHADOW")?.metric ?? 0;
    return [
      crew,
      { label: "DIRECTIVES_EXECUTED", value: formatNumber(executed), note: "jobs finished without you", tone: "ink" },
      { label: "LEADS_QUEUED", value: formatNumber(leads), note: "scored and waiting", tone: "cyan" },
      { label: "HOURS_RECLAIMED", value: `${hours.toFixed(1)}h`, note: "of your time handed back", tone: "pink" },
    ];
  }

  const words = state.deliverables.reduce((sum, item) => sum + item.words, 0);
  const hours = state.deliverables.reduce(
    (sum, item) => sum + PROFILES[item.agentId].hoursPerDirective,
    0,
  );
  return [
    crew,
    { label: "DELIVERABLES", value: formatNumber(state.deliverables.length), note: "finished and in the vault", tone: "ink" },
    { label: "WORDS_WRITTEN", value: formatNumber(words), note: "drafted by the crew", tone: "cyan" },
    { label: "EST_HOURS_SAVED", value: `${hours.toFixed(1)}h`, note: "rough estimate, not a measurement", tone: "pink" },
  ];
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

/** Let a resting operative's chart drain to flat, then leave the object alone so its card can skip rendering. */
function drain(agent: Agent): Agent {
  return agent.throughput.some((value) => value > 0)
    ? { ...agent, throughput: pushSample(agent.throughput, 0) }
    : agent;
}

function replaceAgent(state: SyndicateState, id: AgentId, change: (agent: Agent) => Agent): Agent[] {
  return state.agents.map((agent) => (agent.id === id ? change(agent) : agent));
}

/** Why real work cannot start right now, or null when it can. */
function liveBlock(state: SyndicateState): Line | null {
  if (state.mode === "sim") return null;
  if (state.mode === "linking") {
    return sys("warn", "still requesting the Claude uplink. Try again in a moment");
  }
  if (state.uplinkDenied) return sys("error", state.uplinkDenied);
  if (!briefReady(state.brief)) {
    return sys("error", "no business brief on file. Open BRIEF and tell the crew who they work for");
  }
  return null;
}

function transition(agent: Agent, status: AgentStatus, mode: Mode): { agent: Agent; line: Line } {
  const profile = PROFILES[agent.id];
  const live = mode !== "sim";
  if (agent.status === status) {
    return { agent, line: sys("warn", `${agent.id} is already ${status}`) };
  }
  // Real work cannot be paused halfway: leaving a job throws the draft away.
  const cleared = live ? { progress: 0, draft: "", sampledChars: 0 } : {};

  if (status === "active") {
    const directive = currentDirective(agent, mode);
    if (live) {
      return {
        agent: { ...agent, ...cleared, status, task: directive.text, run: agent.run + 1 },
        line: { source: agent.id, level: "success", message: `deployed. On the job: ${directive.text}` },
      };
    }
    const message =
      agent.status === "offline"
        ? "boot sequence complete. Deployed and hunting"
        : agent.progress > 0
          ? `redeployed. Resuming directive at ${Math.floor(agent.progress)}%`
          : "deployed. Initiated task sequence...";
    return {
      agent: { ...agent, status, task: directive.text },
      line: { source: agent.id, level: "success", message },
    };
  }

  if (status === "idle") {
    const message =
      agent.status === "offline"
        ? "booted. Standing by for orders"
        : live && agent.draft
          ? "recalled mid-job. Draft discarded"
          : "recalled. Standing by";
    return {
      agent: { ...agent, ...cleared, status, task: live ? LIVE_IDLE : profile.idleTask },
      line: { source: agent.id, level: "warn", message },
    };
  }

  return {
    agent: { ...agent, ...cleared, status, task: live ? LIVE_OFFLINE : profile.offlineTask },
    line: { source: agent.id, level: "error", message: "powered down. Node dark" },
  };
}

function setStatus(
  state: SyndicateState,
  ids: readonly AgentId[],
  status: AgentStatus,
  ts: string,
): SyndicateState {
  if (status === "active") {
    const blocked = liveBlock(state);
    if (blocked) return write(state, ts, [blocked]);
  }
  const lines: Line[] = [];
  const agents = state.agents.map((agent) => {
    if (!ids.includes(agent.id)) return agent;
    const result = transition(agent, status, state.mode);
    lines.push(result.line);
    return result.agent;
  });
  return write({ ...state, agents }, ts, lines);
}

function tick(state: SyndicateState, ts: string, rolls: Rolls): SyndicateState {
  if (state.mode !== "sim") {
    // Live: time passes and the chart follows the writing. Nothing else moves by itself.
    const agents = state.agents.map((agent): Agent => {
      if (agent.status !== "active") return drain(agent);
      const written = Math.max(0, agent.draft.length - agent.sampledChars);
      return {
        ...agent,
        sampledChars: agent.draft.length,
        throughput: pushSample(agent.throughput, Math.min(MAX_STEP, written / CHARS_PER_STEP)),
      };
    });
    return { ...state, agents, uptime: state.uptime + 1 };
  }

  const lines: Line[] = [];
  const agents = state.agents.map((agent): Agent => {
    if (agent.status !== "active") return drain(agent);

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

    const finished = currentDirective(agent, "sim");
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

/** Live: Claude has written more of the job in hand. */
function jobText(state: SyndicateState, id: AgentId, run: number, text: string): SyndicateState {
  const agents = replaceAgent(state, id, (agent) => {
    if (agent.status !== "active" || agent.run !== run) return agent;
    const share = text.length / expectedChars(currentDirective(agent, state.mode));
    // Hold short of full until the piece is actually handed in.
    return { ...agent, draft: text, progress: Math.min(95, share * 100) };
  });
  return { ...state, agents };
}

/** Live: a finished piece came back. File it and decide what the operative does next. */
function jobDone(
  state: SyndicateState,
  id: AgentId,
  run: number,
  deliverable: Deliverable,
  ts: string,
): SyndicateState {
  const agent = state.agents.find((candidate) => candidate.id === id);
  // A reply to a job the operative has since been pulled off: drop it.
  if (!agent || agent.status !== "active" || agent.run !== run) return state;

  const jobs = PROFILES[id].jobs;
  const wasInjected = agent.override !== null;
  const directiveIndex = wasInjected
    ? agent.directiveIndex
    : (agent.directiveIndex + 1) % jobs.length;
  const listFinished = !wasInjected && directiveIndex === 0;
  const rested: Agent = {
    ...agent,
    override: null,
    directiveIndex,
    progress: 0,
    draft: "",
    sampledChars: 0,
  };

  const lines: Line[] = [
    {
      source: id,
      level: "success",
      message: `delivered "${deliverable.title}" to the vault (${formatNumber(deliverable.words)} words)`,
    },
  ];
  if (deliverable.truncated) {
    lines.push({
      source: id,
      level: "warn",
      message: "that one was cut short at the length limit. Ask for less in one go",
    });
  }

  // Auto-requeue walks to the end of the job list and stops. It never loops by itself.
  let next: Agent;
  if (agent.config.autoRequeue && !wasInjected && !listFinished) {
    next = { ...rested, task: jobs[directiveIndex].text, run: agent.run + 1 };
    lines.push({ source: id, level: "info", message: `next job: ${jobs[directiveIndex].text}` });
  } else {
    next = { ...rested, status: "idle", task: LIVE_IDLE };
    lines.push({
      source: id,
      level: "info",
      message: listFinished
        ? "job list complete. Deploy again to run it from the top, or assign a job"
        : "standing by. Deploy for the next job",
    });
  }

  return write(
    {
      ...state,
      agents: replaceAgent(state, id, () => next),
      deliverables: [deliverable, ...state.deliverables.filter((item) => item.id !== deliverable.id)],
    },
    ts,
    lines,
  );
}

/** Live: a job fell over. Stand the operative down and say why. */
function jobFailed(
  state: SyndicateState,
  id: AgentId,
  run: number,
  code: string,
  detail: string,
  ts: string,
): SyndicateState {
  const agent = state.agents.find((candidate) => candidate.id === id);
  if (!agent || agent.status !== "active" || agent.run !== run) return state;

  const { message, fatal } = explainFailure(code, detail);
  const stand = (operative: Agent): Agent => ({
    ...operative,
    status: "idle",
    task: LIVE_IDLE,
    progress: 0,
    draft: "",
    sampledChars: 0,
  });
  // When Claude is off for the whole page, every job in flight is dead too.
  const agents = state.agents.map((operative) =>
    operative.id === id || (fatal && operative.status === "active") ? stand(operative) : operative,
  );
  return write({ ...state, agents, uplinkDenied: fatal ? message : state.uplinkDenied }, ts, [
    { source: id, level: "error", message },
  ]);
}

function assign(state: SyndicateState, id: AgentId, raw: string, ts: string): SyndicateState {
  const text = raw.trim().slice(0, 240);
  if (!text) return state;
  const blocked = liveBlock(state);
  if (blocked) return write(state, ts, [blocked]);

  const live = state.mode !== "sim";
  const override: Directive = live
    ? { text, task: text, done: "", gain: 1 }
    : { text, done: "operator directive executed", gain: 1 };
  const agents = replaceAgent(state, id, (agent) => ({
    ...agent,
    status: "active",
    override,
    progress: 0,
    task: text,
    ...(live ? { draft: "", sampledChars: 0, run: agent.run + 1 } : {}),
  }));
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
  const agents = replaceAgent(state, id, (agent) => ({
    ...agent,
    config: { ...agent.config, ...patch },
  }));
  const summary = (Object.keys(patch) as (keyof AgentConfig)[])
    .map((key) => `${CONFIG_LABEL[key]}=${String(patch[key])}`)
    .join(" ");
  return write({ ...state, agents }, ts, [
    { source: "OPERATOR", level: "input", message: `patch ${id.toLowerCase()} ${summary}` },
  ]);
}

const BANNER = sys("info", "SYNDICATE.OS v3.0 // kernel handshake OK");

function boot(state: SyndicateState, ts: string, hasHost: boolean): SyndicateState {
  if (state.booted) return state;
  const booted = { ...state, booted: true };
  // The uplink beat the boot sequence: the live greeting is already in the feed.
  if (state.mode === "live") return write(booted, ts, [BANNER]);
  if (hasHost && !state.linkSettled) {
    // Swap the demo crew out before anything pretend reaches the feed.
    return write({ ...booted, mode: "linking", agents: LIVE_AGENTS }, ts, [
      BANNER,
      sys("info", "requesting Claude uplink..."),
    ]);
  }
  const count = (status: AgentStatus) =>
    state.agents.filter((agent) => agent.status === status).length;
  return write(booted, ts, [
    BANNER,
    sys(
      "info",
      `${state.agents.length} operatives registered: ${count("active")} live, ${count("idle")} idle, ${count("offline")} dark`,
    ),
    { source: "HYPE_BEAST", level: "info", message: "initiated task sequence..." },
    { source: "THE_SHADOW", level: "info", message: "secured 12 new leads" },
    sys("warn", "simulation: no model is connected, so the work shown is pretend"),
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
  const input = raw.trim().slice(0, 300);
  if (!input) return state;

  const live = state.mode !== "sim";
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
        sys(
          "info",
          live
            ? "live: every job is written by the connected model from your brief and filed in the vault"
            : "simulation: connect a model and the same commands do real work",
        ),
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
              live
                ? `delivered ${echoed.deliverables.filter((item) => item.agentId === agent.id).length}`
                : `clock x${agent.config.clock}  done ${agent.completed}`,
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
      if (live) {
        return reply(sys("warn", "clock speed belongs to the simulation. Real work takes as long as it takes"));
      }
      const ids = resolveTargets(args[0]);
      const speed = Number(args[1]);
      if (!args[0] || ![1, 2, 3, 4, 5].includes(speed)) return usage("clock");
      if (!ids || ids.length !== 1) return noMatch(args[0]);
      return patchConfig(echoed, ids[0], { clock: speed as ClockSpeed }, ts);
    }

    case "brief": {
      if (!live) return reply(sys("info", "the brief only matters when the work is real. This is the simulation"));
      if (!briefReady(echoed.brief)) return reply(sys("warn", "no business brief on file. Open BRIEF to add one"));
      return reply(
        sys("info", `working for: ${echoed.brief.name}`),
        sys("info", `sells: ${echoed.brief.offer}`),
        ...(echoed.brief.area ? [sys("info", `where: ${echoed.brief.area}`)] : []),
      );
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
      return boot(state, action.ts, action.hasHost);
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

    case "GO_LIVE": {
      if (state.mode === "live") {
        // Already working: the operator swapped one model for another.
        if (state.engine === action.label) return state;
        return write({ ...state, engine: action.label, uplinkDenied: null }, action.ts, [
          sys("success", `model switched. Now running on ${action.label}`),
        ]);
      }
      return write(
        {
          ...state,
          mode: "live",
          linkSettled: true,
          engine: action.label,
          uplinkDenied: null,
          agents: state.mode === "linking" ? state.agents : LIVE_AGENTS,
          vaultNote: action.persistent
            ? null
            : "Storage is not available in this view, so finished work lasts only until the page is closed. Copy what you want to keep.",
        },
        action.ts,
        [
          sys("success", `uplink established: ${action.label}. Operatives now do real work`),
          sys("info", "deploy an operative, or type: assign shadow <any ads job>"),
        ],
      );
    }
    case "GO_SIM": {
      if (state.mode === "sim") return state;
      return write(
        { ...state, mode: "sim", engine: null, uplinkDenied: null, agents: INITIAL_AGENTS },
        action.ts,
        [sys("warn", "model disconnected. Back to the simulation, so the work shown is pretend")],
      );
    }
    case "LINK_FAILED": {
      if (state.mode !== "linking") return { ...state, linkSettled: true };
      return write(
        { ...state, mode: "sim", linkSettled: true, agents: INITIAL_AGENTS },
        action.ts,
        [sys("warn", "no Claude uplink in this view. Running the simulation, so the work shown is pretend")],
      );
    }
    case "JOB_TEXT":
      return jobText(state, action.id, action.run, action.text);
    case "JOB_DONE":
      return jobDone(state, action.id, action.run, action.deliverable, action.ts);
    case "JOB_FAILED":
      return jobFailed(state, action.id, action.run, action.code, action.detail, action.ts);

    case "VAULT_SYNC": {
      // The store is the record. Keep only local pieces it has not confirmed yet.
      const stored = new Set(action.deliverables.map((item) => item.id));
      const unsaved = state.deliverables.filter((item) => !item.saved && !stored.has(item.id));
      const deliverables = [...unsaved, ...action.deliverables].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      if (state.vaultLoaded) return { ...state, deliverables };
      // First load: start each resting operative on the first job it has not already delivered.
      const agents = state.agents.map((agent) => {
        if (agent.status === "active" || agent.override) return agent;
        const done = new Set(
          deliverables.filter((item) => item.agentId === agent.id).map((item) => item.directive),
        );
        const next = PROFILES[agent.id].jobs.findIndex((item) => !done.has(item.text));
        return next > 0 ? { ...agent, directiveIndex: next } : agent;
      });
      return { ...state, deliverables, agents, vaultLoaded: true };
    }
    case "VAULT_NOTE":
      return state.vaultNote === action.note ? state : { ...state, vaultNote: action.note };
    case "DELIVERABLE_SAVED":
      return {
        ...state,
        deliverables: state.deliverables.map((item) =>
          item.id === action.id ? { ...item, saved: true } : item,
        ),
      };
    case "DELIVERABLE_REMOVED": {
      const removed = state.deliverables.find((item) => item.id === action.id);
      if (!removed) return state;
      return write(
        { ...state, deliverables: state.deliverables.filter((item) => item.id !== action.id) },
        action.ts,
        [{ source: "OPERATOR", level: "input", message: `removed "${removed.title}" from the vault` }],
      );
    }
    case "BRIEF_SET": {
      const next = { ...state, brief: action.brief };
      if (!action.announce) return next;
      return write(next, action.ts, [
        { source: "OPERATOR", level: "input", message: `brief updated: now working for ${action.brief.name}` },
      ]);
    }
  }
}
