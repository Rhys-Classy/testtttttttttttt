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

/** A real job: what the card shows, what the model is asked for, and how long it may run. */
const job = (text: string, words: number, task: string): Directive => ({
  text,
  task,
  words,
  done: "",
  gain: 1,
});

/**
 * The crew does one thing: bring in solid prospects with paid ads. Two
 * operatives run the channels (Meta, Google), one keeps the leads good, and
 * one watches the money. Each has a scripted playbook for the simulation and
 * a list of real jobs for when a model is connected.
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
    jobs: [
      job(
        "Building the Meta lead campaign...",
        650,
        "Design a Meta (Facebook and Instagram) lead generation campaign, ready to build in Ads Manager. Give: CAMPAIGN (objective, buying type, and budget approach using [DAILY BUDGET]), then 3 AD SETS, each with a different audience: who it targets, locations, age range, detailed targeting or lookalike source, placements, and why this audience is worth testing. Finish with LAUNCH SETTINGS: optimisation event, attribution setting, schedule, and the 3 mistakes that most often waste money on a first lead campaign.",
      ),
      job(
        "Writing 5 Meta ads...",
        650,
        "Write 5 Meta ads for a lead campaign, each built on a different angle: the problem, the result, proof, an objection answered, and a direct offer. For each ad give: ANGLE, PRIMARY TEXT (under 90 words, and the first line must stop the scroll), HEADLINE (under 8 words), DESCRIPTION (one line), BUTTON (the call-to-action to pick), and CREATIVE (what the image or short video should show, described so someone could make it).",
      ),
      job(
        "Designing the lead form...",
        500,
        "Design a Meta instant form that screens for serious prospects, using the higher-intent form type. Give: INTRO (headline and two lines), QUESTIONS (5 at most: contact details plus the 2 or 3 qualifying questions that best separate a solid prospect from a time-waster, with answer options where multiple choice works), PRIVACY (a one-line placeholder for the privacy policy link), and THANK-YOU SCREEN (headline, what happens next, button). Say in two lines why each qualifying question is there.",
      ),
      job(
        "Planning retargeting...",
        500,
        "Plan a Meta retargeting campaign for people who showed interest but did not enquire. Give: 3 AUDIENCES (who, the time window, and why), then one ad for each with PRIMARY TEXT, HEADLINE and BUTTON, written to pick up where their interest left off. Finish with BUDGET (as a share of [DAILY BUDGET]) and FREQUENCY (how often is too often, and what to do when it gets there).",
      ),
    ],
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
    jobs: [
      job(
        "Building the Google Search campaign...",
        650,
        "Design a Google Ads search campaign, ready to build. Give: CAMPAIGN SETTINGS (goal, networks to switch off, locations, language, schedule, the bidding strategy to start on, and budget using [DAILY BUDGET]), then 3 AD GROUPS organised by what the searcher wants, each with its theme and the page it should send people to using [LANDING PAGE]. Finish with SETTINGS THAT LEAK MONEY: the defaults to change before launch, and why.",
      ),
      job(
        "Choosing keywords and negatives...",
        700,
        "Build the keyword plan for a Google search campaign with 3 ad groups. For each ad group give 10 to 12 KEYWORDS with match type (phrase or exact), chosen for buying intent, not curiosity. Then give a shared NEGATIVE KEYWORD LIST of 40 terms that block job seekers, do-it-yourself searchers, freebie hunters and irrelevant meanings. Do not quote search volumes or costs per click: you do not have that data.",
      ),
      job(
        "Writing responsive search ads...",
        700,
        "Write a responsive search ad for each of 3 ad groups. For each give 15 HEADLINES of 30 characters or fewer and 4 DESCRIPTIONS of 90 characters or fewer, with the character count in brackets after each. Spread the headlines across what is offered, the location, proof, the offer and the call to action. Then give 4 SITELINKS (title and two description lines), 6 CALLOUTS and one STRUCTURED SNIPPET.",
      ),
      job(
        "Setting up lead tracking...",
        550,
        "Write the conversion tracking plan for a business that wants enquiries and booked calls from Google Ads. Give: WHAT COUNTS AS A LEAD (the primary conversions, and what should be secondary), HOW TO SET IT UP (step by step in plain words: form submissions, phone calls from ads, calls from the website), HOW TO TEST IT (prove one real enquiry is counted once), and a PRE-LAUNCH CHECKLIST of 10 items to tick off before the campaign goes live.",
      ),
    ],
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
    jobs: [
      job(
        "Building the prospect scorecard...",
        500,
        "Build a scorecard for judging an incoming lead in under a minute. Give: WHAT A SOLID PROSPECT LOOKS LIKE (5 signals), RED FLAGS (5 signs of a time-waster), a SCORING TABLE in plain text (criterion, and what scores 0, 1 and 2), SCORE BANDS (hot, warm, pass, and what to do with each), and the 5 QUALIFYING QUESTIONS to ask on first contact, in the order to ask them.",
      ),
      job(
        "Writing the 5-minute first response...",
        450,
        "Write what gets sent to a new lead within five minutes of their enquiry: a TEXT MESSAGE (under 50 words), an EMAIL (subject and body, under 120 words), and a CALL SCRIPT for the first phone call (the opening line, the qualifying questions woven in naturally, and how to book the next step). Each one names the next step and makes it easy to say yes.",
      ),
      job(
        "Writing the 7-day follow-up...",
        550,
        "Write a 7-day follow-up for a lead who enquired and then went quiet. Give 6 touches mixing text, email and one phone call. For each: DAY, CHANNEL and the MESSAGE in full. Each touch adds something new: a proof point, an answer to a likely objection, or a simpler next step. The last one is a polite close-the-file message that leaves the door open.",
      ),
      job(
        "Scripting the discovery call...",
        600,
        "Write the script for a 15-minute discovery call with a qualified prospect. Give: OPENING (set the agenda in two sentences), DISCOVERY QUESTIONS (8, in order, each with what a good answer sounds like), HOW TO PRESENT THE OFFER (three sentences tied to what they just said), HANDLING THE 3 MOST LIKELY OBJECTIONS, and THE CLOSE (how to ask for the next step, and what to send afterwards).",
      ),
    ],
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
    jobs: [
      job(
        "Setting the ad budget and lead targets...",
        600,
        "Build the budget plan for running Google and Meta ads together, using [MONTHLY AD BUDGET]. Give: THE SPLIT (percentages for Google search, Meta prospecting and Meta retargeting, with one line of reasoning each), THE MATHS as simple formulas using [AVERAGE SALE VALUE], [GROSS MARGIN %] and [CLOSE RATE %] to work out the most a lead can cost and still be worth it, and THE FIRST 30 DAYS (what to expect while campaigns learn, and what not to touch). Do not invent the business's figures. You may add one worked example with round numbers, clearly labelled as an example.",
      ),
      job(
        "Writing the weekly kill-and-scale rules...",
        550,
        "Write the rules for a 20-minute weekly ads review. Give: THE 6 NUMBERS TO PULL from Google Ads and Meta Ads Manager and where to find each, KILL RULES (plain if-then rules for pausing a keyword, an ad or an ad set, with thresholds given as multiples of [TARGET COST PER LEAD]), SCALE RULES (when to raise a budget and by how much), and WHAT TO LEAVE ALONE. Finish with a one-page checklist version.",
      ),
      job(
        "Building the monthly results report...",
        500,
        "Build a monthly ad results report the owner can fill in in ten minutes. Give: HEADLINE NUMBERS (spend, leads, cost per lead, booked calls, sales, return on ad spend, each with its formula), BY CHANNEL (the same for Google and for Meta), WHAT WORKED, WHAT DID NOT, and NEXT MONTH'S PLAN (three actions). Use a square-bracket placeholder for every figure.",
      ),
      job(
        "Costing a solid prospect...",
        500,
        "Write a plain-English guide to what a solid prospect is worth to this business. Show, with formulas and placeholders, how to get from [AVERAGE SALE VALUE] and [CLOSE RATE %] to the value of one lead, one booked call and one sale, and how lead quality changes the answer: compare a cheap lead that rarely buys with a dearer one that often does. Finish with THE ONE NUMBER TO WATCH each week, and why.",
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
