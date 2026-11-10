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

/** A real job: what the card shows, what Claude is asked for, and how long it may run. */
const job = (text: string, words: number, task: string): Directive => ({
  text,
  task,
  words,
  done: "",
  gain: 1,
});

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
    remit: "Your field is marketing: content, ads and campaigns that bring in enquiries.",
    jobs: [
      job(
        "Writing 5 short-form video scripts...",
        650,
        "Write 5 short-form video scripts (Reels, TikTok, Shorts), 20 to 35 seconds each, that the owner can film on a phone. Give each a different angle: a before-and-after, a myth people believe, how the job is done, an objection answered, and a behind-the-scenes moment. For each script give: HOOK (the line for the first two seconds), ON SCREEN (what to film), SCRIPT (the words to say), and CALL TO ACTION.",
      ),
      job(
        "Writing 3 Facebook and Instagram ads...",
        500,
        "Write 3 Facebook and Instagram ads, each taking a different angle and aimed at a different kind of customer. For each ad give: AUDIENCE (who it is for), PRIMARY TEXT (under 90 words), HEADLINE (under 8 words), DESCRIPTION (one line), BUTTON (the call-to-action button to pick), and IMAGE OR VIDEO (what to show).",
      ),
      job(
        "Planning 14 days of social posts...",
        900,
        "Write a 14-day social media plan. For each day give: DAY, FORMAT (photo, carousel, reel or story), CAPTION (written in full, ready to post), and WHAT TO SHOW. Mix proof of work, education, behind-the-scenes and direct offers, and never run two sales posts back to back.",
      ),
      job(
        "Writing a 3-email follow-up for new enquiries...",
        550,
        "Write a 3-email sequence for someone who has just enquired but not yet booked: one sent straight away, one two days later, one a week later. For each email give SUBJECT, SEND (when), and BODY. Each email has one job and one call to action.",
      ),
      job(
        "Writing 5 Google Business Profile posts...",
        600,
        "Write 5 Google Business Profile posts of 80 to 120 words each: one about a core service, one answering a common question, one showing a typical recent job, one seasonal or timely, and one direct offer. Give each a TITLE, the POST, and the BUTTON to attach.",
      ),
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
    remit:
      "Your field is lead generation: finding the right customers and turning interest into booked work.",
    jobs: [
      job(
        "Profiling the 3 best-fit customers...",
        550,
        "Describe the 3 kinds of customer most worth chasing. For each give: WHO THEY ARE, WHAT SETS THEM OFF (the moment they start looking), WHAT HOLDS THEM BACK, WHERE TO REACH THEM (channels and kinds of place, never named businesses or people), and THE MESSAGE THAT LANDS (two sentences in the business's voice).",
      ),
      job(
        "Writing a 5-touch chase for quotes gone quiet...",
        500,
        "Write a 5-touch follow-up for a customer who received a quote and stopped replying. Mix text messages and emails across about three weeks. For each touch give: DAY, CHANNEL, and the MESSAGE in full. Stay friendly and never pushy, and make the last touch a polite close-the-file message.",
      ),
      job(
        "Drafting referral-partner outreach...",
        600,
        "List 6 types of local business whose customers are also a good fit for this business. Give types only and never name a real business. For each give: WHY THEY ARE A FIT, WHAT IS IN IT FOR THEM, and a short OUTREACH MESSAGE the owner can send to propose a referral arrangement.",
      ),
      job(
        "Writing a lead magnet and its landing page...",
        700,
        "Create a free guide that a likely customer would swap their contact details for. Give: GUIDE TITLE, then WHAT IS INSIDE (6 to 8 points, each written out in a sentence or two so it is useful on its own), then the LANDING PAGE copy: headline, sub-headline, three benefit points, the form's button text, and one line of reassurance about how their details are used.",
      ),
      job(
        "Scripting replies that turn enquiries into bookings...",
        550,
        "Write the reply to each of the 6 first messages a business like this receives most: the price shopper, 'do you service my area', 'how long does it take', 'I'm just looking for ideas', 'can you do it cheaper', and a one-word 'price?'. For each give THEY SAY and YOU REPLY. Every reply moves toward the next step in buying, such as booking a quote or a call.",
      ),
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
    remit:
      "Your field is customer support: fast, clear answers that keep customers happy and reviews high.",
    jobs: [
      job(
        "Writing replies to the 8 most common questions...",
        550,
        "Write ready-to-send replies to the 8 questions a business like this is asked most often before and during a job. For each give QUESTION and REPLY. Keep every reply short enough to send as a text message.",
      ),
      job(
        "Writing review responses...",
        500,
        "Write 6 responses to online reviews: two for 5-star reviews, two for 3-star reviews with a mild complaint, and two for 1-star reviews (one fair, one unfair). For each give THE REVIEW (a one-line example, clearly an example) and THE RESPONSE. Responses to complaints stay calm, take the conversation offline and never argue.",
      ),
      job(
        "Writing the customer journey messages...",
        600,
        "Write the messages a customer receives from booking to finished job: BOOKING CONFIRMED, WHAT TO EXPECT (a few days before), DAY-BEFORE REMINDER, ON OUR WAY, JOB COMPLETE, and REVIEW REQUEST (two days later). Give each as a text message under 60 words, plus an email version of BOOKING CONFIRMED and JOB COMPLETE.",
      ),
      job(
        "Writing the FAQ page...",
        750,
        "Write a 12-question FAQ page. Cover price and quoting, timeframes, what is and is not included, materials and choices, mess and access during the job, payment, and what happens if something is not right. Give each as QUESTION and ANSWER.",
      ),
      job(
        "Building an objection-handling cheat sheet...",
        550,
        "Write a cheat sheet for the 7 objections most likely to stall a sale. For each give: THEY SAY, WHAT IS REALLY GOING ON, and SAY THIS (a natural reply in the business's voice, two or three sentences).",
      ),
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
    remit:
      "Your field is the money side of marketing: pricing, budgets and getting paid, so spend turns into profit.",
    jobs: [
      job(
        "Building a 90-day marketing budget...",
        600,
        "Build a 90-day marketing budget plan the owner can fill in, using [MONTHLY BUDGET] as the amount. Give: a recommended split across channels as percentages with one line of reasoning each, WHAT TO MEASURE for each channel, and the BREAK-EVEN MATHS as simple formulas using [AVERAGE JOB VALUE], [GROSS MARGIN %] and [CLOSE RATE %]. Do not invent the business's figures. You may add one worked example with round numbers, clearly labelled as an example.",
      ),
      job(
        "Writing overdue invoice reminders...",
        450,
        "Write 3 overdue invoice reminders: 7 days overdue (a friendly nudge), 14 days (firm), and 30 days (final notice before further action). Give each as SUBJECT and BODY for email, plus a one-line text message version. Use [INVOICE NUMBER], [AMOUNT] and [DUE DATE].",
      ),
      job(
        "Designing 3 offers that lift job value...",
        550,
        "Design 3 offers that raise the average sale without discounting the core service: bundles, upgrades and add-ons that fit what this business sells. For each give: OFFER NAME, WHAT IS INCLUDED, WHY A CUSTOMER SAYS YES, HOW TO PRESENT IT at quote time, and THE MATHS as a formula the owner fills in with their own costs and prices.",
      ),
      job(
        "Building a weekly lead-to-sale scorecard...",
        600,
        "Build a weekly scorecard that shows whether marketing is paying off. List 8 numbers to track, from enquiries through to cash collected. For each give: WHAT IT IS, HOW TO WORK IT OUT, and WHAT IT TELLS YOU when it moves. Finish with a 5-minute Monday routine for reading the scorecard.",
      ),
      job(
        "Writing deposit and payment terms...",
        500,
        "Write plain-English payment terms to include with a quote: deposit, progress payment, final payment, accepted payment methods, what happens with variations, and late payment. Use a placeholder such as [DEPOSIT %] for every number. Add a short friendly paragraph the owner can use to explain the terms face to face. End with a one-line note that the owner should have the terms checked against local consumer law before using them.",
      ),
    ],
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
 * Auto-requeue starts off, so one click spends one job's worth of Claude usage.
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
