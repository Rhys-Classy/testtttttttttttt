import type { AccentKey, Agent, AgentId, AgentProfile } from "./types";

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

export const PROFILES: Record<AgentId, AgentProfile> = {
  HYPE_BEAST: {
    id: "HYPE_BEAST",
    unit: "OP-01",
    role: "Marketing",
    accent: "pink",
    metricLabel: "ASSETS_SHIPPED",
    hoursPerDirective: 1.5,
    idleTask: "Holding position. Content queue paused.",
    offlineTask: "System standby. Awaiting creative sync.",
    playbook: [
      {
        text: "Generating 5 TikTok scripts for Q4 drop...",
        done: "shipped 5 TikTok scripts to the content vault",
        gain: 5,
      },
      {
        text: "Cutting 12 hook variants for the launch reel...",
        done: "pushed 12 hook variants into A/B rotation",
        gain: 12,
      },
      {
        text: "Rewriting landing page copy. Tone: unhinged.",
        done: "landing page copy deployed. Bounce rate bleeding out",
        gain: 1,
      },
      {
        text: "Scheduling 30 days of posts across 4 channels...",
        done: "locked 30 days of posts into the scheduler",
        gain: 30,
      },
      {
        text: "Drafting 3-part email blast for the waitlist...",
        done: "email sequence armed for 2,418 subscribers",
        gain: 3,
      },
    ],
    chatter: [
      "initiated task sequence...",
      "A/B variant C outperforming control by 31%",
      "rendered thumbnail batch 3/5",
      "hook retention holding at 71% past the 3s mark",
      "analysed 40 competitor captions for pattern gaps",
      "caption pack compiled. Zero corporate tone detected",
      "trend spike detected. Rerouting creative",
    ],
  },
  THE_SHADOW: {
    id: "THE_SHADOW",
    unit: "OP-02",
    role: "Lead Gen",
    accent: "cyan",
    metricLabel: "LEADS_QUEUED",
    hoursPerDirective: 2,
    idleTask: "Gone dark. Watching the perimeter.",
    offlineTask: "System standby. Awaiting target sync.",
    playbook: [
      {
        text: "Scraping LinkedIn. 142 leads queued.",
        done: "LinkedIn sweep complete. Leads scored and queued",
        gain: 23,
      },
      {
        text: "Enriching 86 contacts with verified emails...",
        done: "enriched 86 contacts. 71 verified inboxes",
        gain: 71,
      },
      {
        text: "Sequencing cold outreach: 3-touch cadence...",
        done: "outreach cadence live. First touch delivered",
        gain: 18,
      },
      {
        text: "Mapping decision-makers at 40 target accounts...",
        done: "mapped 112 decision-makers across 40 accounts",
        gain: 40,
      },
      {
        text: "Monitoring intent signals across 6 forums...",
        done: "flagged 9 high-intent prospects for immediate strike",
        gain: 9,
      },
    ],
    chatter: [
      "secured 12 new emails",
      "lead score recalculated: 14 upgraded to HOT",
      "deduplicated 31 records against the CRM",
      'reply detected: "send me pricing"',
      "direct line acquired on a decision-maker",
      "tagged 8 accounts for follow-up in 48h",
      "enrichment pass 2/3 complete",
    ],
  },
  THE_FIXER: {
    id: "THE_FIXER",
    unit: "OP-03",
    role: "Support",
    accent: "acid",
    metricLabel: "TICKETS_CLOSED",
    hoursPerDirective: 1,
    idleTask: "Awaiting new support tickets. Inbox clear.",
    offlineTask: "System standby. Awaiting helpdesk sync.",
    playbook: [
      {
        text: "Triaging 14 inbound tickets. 3 flagged urgent.",
        done: "inbox neutralised. 14 tickets resolved",
        gain: 14,
      },
      {
        text: "Drafting refund response for order #8841...",
        done: "refund processed. Customer downgraded from furious to fine",
        gain: 1,
      },
      {
        text: 'Rebuilding help article: "Where is my order?"',
        done: "help article published. Deflection rate climbing",
        gain: 1,
      },
      {
        text: "Sweeping reviews. Answering anything under 4 stars...",
        done: "answered 7 low-star reviews. 2 already revised upward",
        gain: 7,
      },
      {
        text: "Auditing chatbot fallbacks for dead ends...",
        done: "patched 5 dead-end chatbot flows",
        gain: 5,
      },
    ],
    chatter: [
      "ticket #4471 closed in 38s",
      "CSAT holding at 4.8",
      "escalation avoided: issued store credit",
      "macro deployed: shipping delay apology v3",
      "repeat complaint pattern detected: sizing chart",
      "first-response time: 11s",
      "urgent queue cleared",
    ],
  },
  THE_BANKER: {
    id: "THE_BANKER",
    unit: "OP-04",
    role: "Finance",
    accent: "pink",
    metricLabel: "TXNS_RECONCILED",
    hoursPerDirective: 2.5,
    idleTask: "Ledger balanced. Watching the cash.",
    offlineTask: "System standby. Awaiting financial sync.",
    playbook: [
      {
        text: "Reconciling 212 transactions against the ledger...",
        done: "ledger reconciled. 212 transactions matched, 0 orphans",
        gain: 212,
      },
      {
        text: "Chasing 9 overdue invoices. Tone: polite menace.",
        done: "recovered $4,820 in overdue receivables",
        gain: 9,
      },
      {
        text: "Forecasting 90-day cash runway...",
        done: "runway forecast compiled: 7.4 months at current burn",
        gain: 1,
      },
      {
        text: "Hunting subscriptions nobody uses...",
        done: "killed 4 zombie subscriptions. $312/mo reclaimed",
        gain: 4,
      },
      {
        text: "Assembling the quarterly BAS pack...",
        done: "BAS pack assembled and filed to the vault",
        gain: 1,
      },
    ],
    chatter: [
      "matched payment $1,240 to INV-0931",
      "margin on SKU-204 slipped to 38%. Flagged",
      "payout landed: $6,310",
      "duplicate charge detected and disputed",
      "expense categorised: software / recurring",
      "cash position updated",
      "financial sync complete",
    ],
  },
};

/** Flat sparkline for operatives that are not working. */
const FLAT: number[] = Array.from({ length: 24 }, () => 0);

/**
 * The four operatives as they stand when the dashboard opens. Deterministic on
 * purpose: this renders on the server, so no clocks and no dice in here.
 */
export const INITIAL_AGENTS: Agent[] = [
  {
    id: "HYPE_BEAST",
    status: "active",
    task: PROFILES.HYPE_BEAST.playbook[0].text,
    directiveIndex: 0,
    override: null,
    progress: 62,
    completed: 19,
    metric: 128,
    throughput: [3, 5, 4, 6, 5, 7, 4, 3, 5, 6, 8, 6, 5, 4, 6, 7, 5, 4, 6, 5, 7, 6, 5, 6],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    id: "THE_SHADOW",
    status: "active",
    task: PROFILES.THE_SHADOW.playbook[0].text,
    directiveIndex: 0,
    override: null,
    progress: 38,
    completed: 14,
    metric: 142,
    throughput: [2, 3, 3, 4, 6, 5, 4, 5, 7, 6, 4, 3, 5, 6, 5, 4, 3, 5, 6, 7, 5, 4, 5, 4],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    id: "THE_FIXER",
    status: "idle",
    task: PROFILES.THE_FIXER.idleTask,
    directiveIndex: 0,
    override: null,
    progress: 0,
    completed: 11,
    metric: 316,
    throughput: [...FLAT],
    config: { clock: 3, verbosity: "normal", autoRequeue: true },
  },
  {
    id: "THE_BANKER",
    status: "offline",
    task: PROFILES.THE_BANKER.offlineTask,
    directiveIndex: 0,
    override: null,
    progress: 0,
    completed: 3,
    metric: 1904,
    throughput: [...FLAT],
    config: { clock: 2, verbosity: "quiet", autoRequeue: true },
  },
];
