import { SKILLS } from "./skills";
import type { AccentKey, Agent, AgentId, AgentProfile, BusinessBrief, Directive } from "./types";

export const ACCENTS: Record<AccentKey, { hex: string; label: string }> = {
  pink: { hex: "#FF0055", label: "NEON_PINK" },
  cyan: { hex: "#00F0FF", label: "ELECTRIC_CYAN" },
  acid: { hex: "#39FF14", label: "ACID_GREEN" },
};

export const AGENT_IDS: readonly AgentId[] = [
  "HYPE_BEAST",
  "THE_SHADOW",
  "THE_FIXER",
  "THE_BANKER",
];

/** What a resting operative shows when the work is real. No pretend status lines. */
export const LIVE_IDLE = "Standing by. Deploy to start the next job.";
export const LIVE_OFFLINE = "Powered down. Boot to bring this node back.";

/** No business on file. Live operatives refuse to work until this is filled in. */
export const EMPTY_BRIEF: BusinessBrief = {
  name: "",
  offer: "",
  area: "",
  customer: "",
  edge: "",
  tone: "",
  facts: "",
};

/** An operative's core skills, as the jobs Deploy works through in order. */
const jobsOf = (id: AgentId): Directive[] =>
  SKILLS[id]
    .filter((skill) => skill.core)
    .map((skill) => ({ text: skill.text, task: skill.task, words: skill.words, done: "", gain: 1 }));

/**
 * The crew does one thing: bring in solid prospects with paid ads. Two
 * operatives run the channels (Meta, Google), one keeps the leads good, and
 * one watches the money. Each has a scripted playbook for the simulation and
 * a set of real skills (in skills.ts) for when a model is connected.
 */
export const PROFILES: Record<AgentId, AgentProfile> = {
  HYPE_BEAST: {
    id: "HYPE_BEAST",
    unit: "OP-01",
    role: "Meta Ads",
    accent: "pink",
    metricLabel: "ADS_TESTED",
    hoursPerDirective: 1.5,
    idleTask: "Holding position. Meta campaigns paused.",
    offlineTask: "System standby. Awaiting ad account sync.",
    playbook: [
      {
        text: "Testing 5 ad angles on the Meta lead campaign...",
        done: "5 ad angles live. Angle C is pulling the cheapest leads",
        gain: 5,
      },
      {
        text: "Rebuilding lookalike audiences from closed deals...",
        done: "3 lookalike audiences rebuilt from the last 200 customers",
        gain: 3,
      },
      {
        text: "Rewriting the lead form to screen out time-wasters.",
        done: "lead form tightened. Junk leads down, solid ones holding",
        gain: 1,
      },
      {
        text: "Launching retargeting for the last 30 days of visitors...",
        done: "retargeting live for 2,418 recent visitors",
        gain: 4,
      },
      {
        text: "Pausing tired creatives. Frequency is over 3.",
        done: "paused 6 tired creatives and rotated in fresh ones",
        gain: 6,
      },
    ],
    chatter: [
      "initiated task sequence...",
      "angle C beating control by 31% on cost per lead",
      "creative batch 3/5 approved",
      "frequency creeping on ad set 2. Watching",
      "lead form completion holding at 71%",
      "CPM spike detected. Shifting budget",
      "new audience is out of the learning phase",
    ],
    remit:
      "Your field is Facebook and Instagram advertising: campaigns that bring in enquiries from the right people.",
    skills: SKILLS.HYPE_BEAST,
    jobs: jobsOf("HYPE_BEAST"),
  },
  THE_SHADOW: {
    id: "THE_SHADOW",
    unit: "OP-02",
    role: "Google Ads",
    accent: "cyan",
    metricLabel: "LEADS_QUEUED",
    hoursPerDirective: 2,
    idleTask: "Gone dark. Watching the search terms.",
    offlineTask: "System standby. Awaiting Google Ads sync.",
    playbook: [
      {
        text: "Mining search terms. 142 leads queued.",
        done: "search term sweep complete. 23 wasteful terms blocked",
        gain: 23,
      },
      {
        text: "Adding 86 negative keywords...",
        done: "86 negatives added. Wasted spend cut",
        gain: 12,
      },
      {
        text: "Rewriting search ads for 3 ad groups...",
        done: "new search ads live across 3 ad groups",
        gain: 18,
      },
      {
        text: "Shifting budget to the keywords that close...",
        done: "budget moved to the 9 keywords producing booked calls",
        gain: 9,
      },
      {
        text: "Checking conversion tracking end to end...",
        done: "tracking verified. Every lead is being counted once",
        gain: 4,
      },
    ],
    chatter: [
      "secured 12 new leads",
      'search term flagged: "free". Blocked',
      "impression share up to 64% on money keywords",
      "quality score lifted on 3 keywords",
      "cost per lead holding under target",
      "call extension picked up 2 calls",
      "bid adjusted for mobile, weekday mornings",
    ],
    remit:
      "Your field is Google Ads search campaigns: showing up when someone is actively looking, and paying only for the searches worth having.",
    skills: SKILLS.THE_SHADOW,
    jobs: jobsOf("THE_SHADOW"),
  },
  THE_FIXER: {
    id: "THE_FIXER",
    unit: "OP-03",
    role: "Lead Quality",
    accent: "acid",
    metricLabel: "PROSPECTS_QUALIFIED",
    hoursPerDirective: 1,
    idleTask: "Awaiting new leads. Inbox clear.",
    offlineTask: "System standby. Awaiting inbox sync.",
    playbook: [
      {
        text: "Scoring 14 new leads. 3 flagged hot.",
        done: "14 leads scored. 3 hot ones sent straight to the calendar",
        gain: 14,
      },
      {
        text: "Sending first replies inside 5 minutes...",
        done: "every new lead answered in under 5 minutes",
        gain: 6,
      },
      {
        text: "Chasing 9 leads that went quiet...",
        done: "9 quiet leads chased. 2 booked a call",
        gain: 2,
      },
      {
        text: "Screening out time-wasters and wrong-area enquiries.",
        done: "7 poor-fit enquiries screened out politely",
        gain: 7,
      },
      {
        text: "Booking discovery calls for qualified prospects...",
        done: "5 discovery calls booked for this week",
        gain: 5,
      },
    ],
    chatter: [
      "lead #4471 qualified in 38s",
      "hot lead: budget confirmed, ready this month",
      "follow-up 3 of 5 sent",
      "wrong-area enquiry declined politely",
      "booked call confirmed for Thursday",
      "reply rate holding at 48%",
      "duplicate lead merged",
    ],
    remit:
      "Your field is lead quality: sorting solid prospects from time-wasters and getting the good ones onto a call fast.",
    skills: SKILLS.THE_FIXER,
    jobs: jobsOf("THE_FIXER"),
  },
  THE_BANKER: {
    id: "THE_BANKER",
    unit: "OP-04",
    role: "Budget & ROI",
    accent: "pink",
    metricLabel: "SPEND_TRACKED",
    hoursPerDirective: 2.5,
    idleTask: "Books balanced. Watching the spend.",
    offlineTask: "System standby. Awaiting financial sync.",
    playbook: [
      {
        text: "Reconciling ad spend against booked revenue...",
        done: "spend reconciled. Every dollar traced to a lead source",
        gain: 212,
      },
      {
        text: "Recalculating cost per booked call by channel...",
        done: "cost per booked call: Google down 12%, Meta flat",
        gain: 96,
      },
      {
        text: "Forecasting next month's leads at current budget...",
        done: "forecast ready: 61 leads expected at current spend",
        gain: 61,
      },
      {
        text: "Finding the ad sets burning money...",
        done: "cut 4 ad sets that spent with nothing booked",
        gain: 4,
      },
      {
        text: "Building the monthly results report...",
        done: "monthly report built and filed to the vault",
        gain: 1,
      },
    ],
    chatter: [
      "cost per lead updated: $41",
      "Google out-converting Meta 2 to 1 this week",
      "budget pacing at 96% for the month",
      "ad set flagged: spent $180, nothing booked",
      "return on ad spend holding at 4.2",
      "daily cap reached on campaign 2",
      "spend sync complete",
    ],
    remit:
      "Your field is the money side of advertising: budgets, cost per lead, and knowing what to cut and what to scale.",
    skills: SKILLS.THE_BANKER,
    jobs: jobsOf("THE_BANKER"),
  },
};

/** Flat sparkline for operatives that are not working. */
const FLAT: number[] = Array.from({ length: 24 }, () => 0);

/** Fields that only matter once the work is real. */
const AT_REST = { override: null, draft: "", run: 0, sampledChars: 0 };

/**
 * The four operatives as the scripted demo opens. Deterministic on purpose:
 * this renders on the server, so no clocks and no dice in here.
 */
export const INITIAL_AGENTS: Agent[] = [
  {
    ...AT_REST,
    id: "HYPE_BEAST",
    status: "active",
    task: PROFILES.HYPE_BEAST.playbook[0].text,
    directiveIndex: 0,
    progress: 62,
    completed: 19,
    metric: 128,
    throughput: [3, 5, 4, 6, 5, 7, 4, 3, 5, 6, 8, 6, 5, 4, 6, 7, 5, 4, 6, 5, 7, 6, 5, 6],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    ...AT_REST,
    id: "THE_SHADOW",
    status: "active",
    task: PROFILES.THE_SHADOW.playbook[0].text,
    directiveIndex: 0,
    progress: 38,
    completed: 14,
    metric: 142,
    throughput: [2, 3, 3, 4, 6, 5, 4, 5, 7, 6, 4, 3, 5, 6, 5, 4, 3, 5, 6, 7, 5, 4, 5, 4],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    ...AT_REST,
    id: "THE_FIXER",
    status: "idle",
    task: PROFILES.THE_FIXER.idleTask,
    directiveIndex: 0,
    progress: 0,
    completed: 11,
    metric: 316,
    throughput: [...FLAT],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    ...AT_REST,
    id: "THE_BANKER",
    status: "offline",
    task: PROFILES.THE_BANKER.offlineTask,
    directiveIndex: 0,
    progress: 0,
    completed: 3,
    metric: 1904,
    throughput: [...FLAT],
    config: { clock: 2, verbosity: "quiet", autoRequeue: true },
  },
];

/**
 * The crew when the work is real: everyone at rest with nothing claimed.
 * Auto-requeue starts off, so one click spends one job's worth of model usage.
 */
export const LIVE_AGENTS: Agent[] = AGENT_IDS.map((id) => ({
  ...AT_REST,
  id,
  status: "idle",
  task: LIVE_IDLE,
  directiveIndex: 0,
  progress: 0,
  completed: 0,
  metric: 0,
  throughput: [...FLAT],
  config: { clock: 3, verbosity: "normal", autoRequeue: false },
}));
