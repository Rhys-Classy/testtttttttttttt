import type { AgentId, Skill } from "./types";

/**
 * Everything the crew knows how to do. Each operative has four core skills,
 * which Deploy runs in order, and a set it runs on demand. Skills marked with
 * `input` work on something the owner pastes in: an export from Google Ads or
 * Meta Ads Manager, an enquiry, a page, a set of numbers.
 *
 * Until the app is connected to the ad accounts themselves, pasted exports
 * are how the crew sees real results. Every data skill is told to use only
 * what was pasted and to name what is missing instead of guessing.
 */

const core = (
  id: string,
  name: string,
  about: string,
  text: string,
  words: number,
  task: string,
): Skill => ({ id, name, about, text, words, task, core: true });

const extra = (
  id: string,
  name: string,
  about: string,
  text: string,
  words: number,
  task: string,
  input?: Skill["input"],
): Skill => ({ id, name, about, text, words, task, core: false, input });

export const SKILLS: Record<AgentId, readonly Skill[]> = {
  // ------------------------------------------------------------ Meta Ads ----
  HYPE_BEAST: [
    core(
      "meta-lead-campaign",
      "Lead campaign build",
      "Campaign, three audiences and launch settings, ready for Ads Manager.",
      "Building the Meta lead campaign...",
      650,
      "Design a Meta (Facebook and Instagram) lead generation campaign, ready to build in Ads Manager. Give: CAMPAIGN (objective, buying type, and budget approach using [DAILY BUDGET]), then 3 AD SETS, each with a different audience: who it targets, locations, age range, detailed targeting or lookalike source, placements, and why this audience is worth testing. Finish with LAUNCH SETTINGS: optimisation event, attribution setting, schedule, and the 3 mistakes that most often waste money on a first lead campaign.",
    ),
    core(
      "meta-ads",
      "5 ads",
      "Five ads on five angles, with what each creative should show.",
      "Writing 5 Meta ads...",
      650,
      "Write 5 Meta ads for a lead campaign, each built on a different angle: the problem, the result, proof, an objection answered, and a direct offer. For each ad give: ANGLE, PRIMARY TEXT (under 90 words, and the first line must stop the scroll), HEADLINE (under 8 words), DESCRIPTION (one line), BUTTON (the call-to-action to pick), and CREATIVE (what the image or short video should show, described so someone could make it).",
    ),
    core(
      "meta-lead-form",
      "Lead form",
      "An instant form that screens out time-wasters.",
      "Designing the lead form...",
      500,
      "Design a Meta instant form that screens for serious prospects, using the higher-intent form type. Give: INTRO (headline and two lines), QUESTIONS (5 at most: contact details plus the 2 or 3 qualifying questions that best separate a solid prospect from a time-waster, with answer options where multiple choice works), PRIVACY (a one-line placeholder for the privacy policy link), and THANK-YOU SCREEN (headline, what happens next, button). Say in two lines why each qualifying question is there.",
    ),
    core(
      "meta-retargeting",
      "Retargeting",
      "Three audiences and an ad for each, to win back the nearly-enquired.",
      "Planning retargeting...",
      500,
      "Plan a Meta retargeting campaign for people who showed interest but did not enquire. Give: 3 AUDIENCES (who, the time window, and why), then one ad for each with PRIMARY TEXT, HEADLINE and BUTTON, written to pick up where their interest left off. Finish with BUDGET (as a share of [DAILY BUDGET]) and FREQUENCY (how often is too often, and what to do when it gets there).",
    ),
    extra(
      "meta-performance-review",
      "Performance review",
      "Paste your results: what to kill, what to scale, what to refresh.",
      "Reviewing Meta results...",
      600,
      "Review the Meta ads results the owner pasted. Give: THE HEADLINE (one sentence on how it is going), KILL (what to switch off, and the number that says so), SCALE (what to give more budget, and by how much at most in one step), REFRESH (ads showing fatigue: frequency climbing or results falling), and NEXT 7 DAYS (three actions in order). Where the brief gives no target, judge cost per result against [TARGET COST PER LEAD].",
      {
        label: "Paste your ad set and ad results",
        placeholder:
          "Copy the table out of Ads Manager: name, amount spent, results, cost per result, CTR, frequency...",
      },
    ),
    extra(
      "meta-creative-tests",
      "Creative test plan",
      "Three concepts to test next, with briefs someone can shoot on a phone.",
      "Planning creative tests...",
      600,
      "Plan the next round of creative tests for a Meta lead campaign. Give 3 CONCEPTS that differ in the idea, not just the wording. For each: THE IDEA, WHY IT MIGHT WIN, FORMAT (image, video or carousel), SHOT LIST or LAYOUT (what to capture, in order, so someone can make it on a phone), 2 HOOKS, and THE ONE THING BEING TESTED. Finish with HOW TO READ THE TEST: how long to run it, how much to spend per concept as a multiple of [TARGET COST PER LEAD], and what counts as a winner.",
    ),
    extra(
      "meta-hooks",
      "20 hooks",
      "Twenty first lines, sorted by angle, for ads and video openers.",
      "Writing 20 hooks...",
      450,
      "Write 20 hooks: the first line of an ad, or the first three seconds of a video. Group them under 5 angles (the problem, the result, proof, a myth, a direct offer), 4 per angle, each under 12 words. No clickbait, and nothing the business could not back up.",
    ),
    extra(
      "meta-audiences",
      "Audience ideas",
      "Interests, lookalike sources and exclusions worth testing.",
      "Mapping audiences...",
      550,
      "List the audiences worth testing for a Meta lead campaign. Give: INTEREST AND BEHAVIOUR AUDIENCES (5, each with the targeting to select and why these people buy), LOOKALIKE SOURCES (3, ranked, with the list each is built from), BROAD (when to let Meta find people itself, and what has to be true first), and EXCLUSIONS (who to keep out, and why). Do not quote audience sizes: you do not have that data.",
    ),
    extra(
      "meta-policy-check",
      "Ad policy check",
      "Paste an ad: where Meta might reject it, and a safer rewrite.",
      "Checking an ad against policy...",
      500,
      "Check the ad the owner pasted against the kinds of thing Meta's advertising rules commonly reject: calling out personal attributes, promises of results, before-and-after claims, sensational language, and anything misleading. Give: VERDICT (likely fine, risky, or likely rejected), THE PROBLEM LINES (quote each and say why), and A SAFER VERSION of the whole ad that keeps the selling point. You are working from general knowledge of rules that change: say so in one line, and say the final call is Meta's.",
      { label: "Paste the ad", placeholder: "Primary text, headline and description..." },
    ),
    extra(
      "meta-ad-refresh",
      "Refresh a tired ad",
      "Paste an ad that has gone stale: five fresh takes on it.",
      "Refreshing a tired ad...",
      550,
      "The owner has pasted an ad that used to work and has gone stale. Keep what it is selling and write 5 fresh versions, each changing one thing: the hook, the angle, the proof, the format (say what the new creative shows), and how the offer is framed. For each give PRIMARY TEXT, HEADLINE and WHAT CHANGED.",
      { label: "Paste the ad", placeholder: "Primary text, headline and description..." },
    ),
  ],

  // ---------------------------------------------------------- Google Ads ----
  THE_SHADOW: [
    core(
      "google-search-campaign",
      "Search campaign build",
      "Settings, three ad groups and the defaults that leak money.",
      "Building the Google Search campaign...",
      650,
      "Design a Google Ads search campaign, ready to build. Give: CAMPAIGN SETTINGS (goal, networks to switch off, locations, language, schedule, the bidding strategy to start on, and budget using [DAILY BUDGET]), then 3 AD GROUPS organised by what the searcher wants, each with its theme and the page it should send people to using [LANDING PAGE]. Finish with SETTINGS THAT LEAK MONEY: the defaults to change before launch, and why.",
    ),
    core(
      "google-keywords",
      "Keywords and negatives",
      "Buying-intent keywords per ad group, and 40 negatives.",
      "Choosing keywords and negatives...",
      700,
      "Build the keyword plan for a Google search campaign with 3 ad groups. For each ad group give 10 to 12 KEYWORDS with match type (phrase or exact), chosen for buying intent, not curiosity. Then give a shared NEGATIVE KEYWORD LIST of 40 terms that block job seekers, do-it-yourself searchers, freebie hunters and irrelevant meanings. Do not quote search volumes or costs per click: you do not have that data.",
    ),
    core(
      "google-search-ads",
      "Responsive search ads",
      "Headlines and descriptions to length, with sitelinks and callouts.",
      "Writing responsive search ads...",
      700,
      "Write a responsive search ad for each of 3 ad groups. For each give 15 HEADLINES of 30 characters or fewer and 4 DESCRIPTIONS of 90 characters or fewer, with the character count in brackets after each. Spread the headlines across what is offered, the location, proof, the offer and the call to action. Then give 4 SITELINKS (title and two description lines), 6 CALLOUTS and one STRUCTURED SNIPPET.",
    ),
    core(
      "google-tracking",
      "Lead tracking setup",
      "What counts as a lead, how to set it up, and how to prove it works.",
      "Setting up lead tracking...",
      550,
      "Write the conversion tracking plan for a business that wants enquiries and booked calls from Google Ads. Give: WHAT COUNTS AS A LEAD (the primary conversions, and what should be secondary), HOW TO SET IT UP (step by step in plain words: form submissions, phone calls from ads, calls from the website), HOW TO TEST IT (prove one real enquiry is counted once), and a PRE-LAUNCH CHECKLIST of 10 items to tick off before the campaign goes live.",
    ),
    extra(
      "google-account-audit",
      "Account audit",
      "Paste your tables: where the money is leaking, worst first.",
      "Auditing the Google Ads account...",
      700,
      "Audit the Google Ads account from the tables the owner pasted. Give: THE HEADLINE (one sentence), WHERE THE MONEY IS LEAKING (up to 6 findings, worst first, each with the number that shows it and the fix), WHAT IS WORKING (up to 3, with the number), SETTINGS TO CHECK that the tables cannot show (networks, location options, auto-applied recommendations, how conversions are counted), and THE FIRST 3 FIXES in order. Say which table you would need to go further.",
      {
        label: "Paste your campaign, ad group and keyword tables",
        placeholder:
          "Copy the tables out of Google Ads for the last 30 days: name, cost, clicks, conversions, cost per conversion...",
      },
    ),
    extra(
      "google-search-terms",
      "Search terms clean-up",
      "Paste the search terms report: what to block, what to promote.",
      "Cleaning up search terms...",
      650,
      "Go through the search terms report the owner pasted. Give: ADD AS NEGATIVES (each term or word, the match type to use, and why: wrong intent, wrong service, job seekers, freebie hunters), ADD AS KEYWORDS (search terms that converted or clearly show buying intent, with match type and the ad group they belong in), WATCH (terms spending without converting yet, and how much more to allow each), and MONEY SAVED (the spend of the terms you are blocking, added up from the report).",
      {
        label: "Paste the search terms report",
        placeholder: "Copy the table out of Google Ads: search term, cost, clicks, conversions...",
      },
    ),
    extra(
      "google-weekly-review",
      "Weekly review",
      "Paste two weeks of numbers: what changed and three things to do.",
      "Writing the weekly review...",
      500,
      "Write the weekly Google Ads review from the numbers the owner pasted, this week against the week before. Give: THE WEEK IN ONE LINE, THE NUMBERS (spend, clicks, leads, cost per lead, each with the change and whether it matters), THE 3 BIGGEST CHANGES and the most likely cause of each, and 3 THINGS TO DO THIS WEEK in order. Plain words, ready to forward to someone who does not run ads.",
      {
        label: "Paste this week's numbers and last week's",
        placeholder: "Spend, clicks, leads and cost per lead for each of the two weeks, by campaign if you have it...",
      },
    ),
    extra(
      "google-quality-score",
      "Quality Score fixes",
      "Paste keywords with their scores: the weak part of each and the fix.",
      "Working on Quality Score...",
      550,
      "Work out how to lift Quality Score from the keyword table the owner pasted. For each keyword scoring 6 or under give: THE WEAK PART (expected click-through rate, ad relevance or landing page experience, as the table shows it) and THE FIX. Then give THE 3 CHANGES that would lift the most keywords at once. If the table does not include the three component columns, say so and explain how to add them.",
      {
        label: "Paste your keywords with Quality Score columns",
        placeholder:
          "Keyword, Quality Score, expected CTR, ad relevance, landing page experience...",
      },
    ),
    extra(
      "google-landing-page",
      "Landing page check",
      "Paste the page: does it deliver what the ad promised?",
      "Checking the landing page...",
      600,
      "Check the landing page the owner pasted against the ad sending people to it. Give: FIRST IMPRESSION (does the top of the page repeat what the ad promised?), WHAT IS MISSING (proof, a clear next step, answers to the obvious questions), WHAT IS IN THE WAY (anything between the visitor and enquiring), A REWRITTEN TOP SECTION (headline, sub-headline, three points and the button), and THE FORM (which fields to keep and which to cut).",
      {
        label: "Paste the page's text, and the ad if you have it",
        placeholder: "Select all the text on the landing page and paste it here. Add the ad underneath...",
      },
    ),
    extra(
      "google-competitor-ads",
      "Competitor ad teardown",
      "Paste rival ads: what they all say, and the angle they left open.",
      "Tearing down competitor ads...",
      550,
      "Break down the competitor ads the owner pasted. Give: WHAT THEY ARE ALL SAYING (the claims everyone makes, so they no longer stand out), WHAT NOBODY IS SAYING (the gaps), THE STRONGEST AD and why it works, and 3 ANGLES for this business that the competitors have left open, each with a sample headline and description. Judge only what was pasted: do not guess at their results or budgets.",
      {
        label: "Paste the competitor ads",
        placeholder: "Search for what you sell, then copy the ads that show up: headlines and descriptions...",
      },
    ),
  ],

  // -------------------------------------------------------- Lead Quality ----
  THE_FIXER: [
    core(
      "lead-scorecard",
      "Prospect scorecard",
      "Judge any lead in under a minute: signals, red flags, score bands.",
      "Building the prospect scorecard...",
      500,
      "Build a scorecard for judging an incoming lead in under a minute. Give: WHAT A SOLID PROSPECT LOOKS LIKE (5 signals), RED FLAGS (5 signs of a time-waster), a SCORING TABLE in plain text (criterion, and what scores 0, 1 and 2), SCORE BANDS (hot, warm, pass, and what to do with each), and the 5 QUALIFYING QUESTIONS to ask on first contact, in the order to ask them.",
    ),
    core(
      "lead-first-response",
      "5-minute first response",
      "The text, email and call script that go out the moment a lead lands.",
      "Writing the 5-minute first response...",
      450,
      "Write what gets sent to a new lead within five minutes of their enquiry: a TEXT MESSAGE (under 50 words), an EMAIL (subject and body, under 120 words), and a CALL SCRIPT for the first phone call (the opening line, the qualifying questions woven in naturally, and how to book the next step). Each one names the next step and makes it easy to say yes.",
    ),
    core(
      "lead-follow-up",
      "7-day follow-up",
      "Six touches for a lead who enquired and went quiet.",
      "Writing the 7-day follow-up...",
      550,
      "Write a 7-day follow-up for a lead who enquired and then went quiet. Give 6 touches mixing text, email and one phone call. For each: DAY, CHANNEL and the MESSAGE in full. Each touch adds something new: a proof point, an answer to a likely objection, or a simpler next step. The last one is a polite close-the-file message that leaves the door open.",
    ),
    core(
      "lead-discovery-call",
      "Discovery call script",
      "A 15-minute call that ends in a next step.",
      "Scripting the discovery call...",
      600,
      "Write the script for a 15-minute discovery call with a qualified prospect. Give: OPENING (set the agenda in two sentences), DISCOVERY QUESTIONS (8, in order, each with what a good answer sounds like), HOW TO PRESENT THE OFFER (three sentences tied to what they just said), HANDLING THE 3 MOST LIKELY OBJECTIONS, and THE CLOSE (how to ask for the next step, and what to send afterwards).",
    ),
    extra(
      "lead-triage",
      "Triage a lead",
      "Paste an enquiry: hot, warm or pass, and the reply to send now.",
      "Triaging a lead...",
      400,
      "Triage the enquiry the owner pasted. Give: SCORE (hot, warm or pass) with the two things in the message that decided it, WHAT IS STILL UNKNOWN (the questions to ask before spending time on it), NEXT STEP (one action, today), and THE REPLY to send now, written in full, that asks the most important missing question and offers a next step.",
      {
        label: "Paste the enquiry",
        placeholder: "The message, form answers or call notes, exactly as they came in...",
      },
    ),
    extra(
      "lead-objection",
      "Answer an objection",
      "Paste what they said: the worry behind it and three ways to reply.",
      "Answering an objection...",
      400,
      "The owner has pasted what a prospect said. Give: WHAT THEY REALLY MEAN (the worry behind the words), 3 REPLIES in the business's voice (one that answers it head on, one that asks a question back, one that takes the pressure off), and WHAT NOT TO SAY. Keep each reply short enough to say out loud or send as a text.",
      { label: "Paste what the prospect said", placeholder: "\"It's more than I wanted to spend...\"" },
    ),
    extra(
      "lead-call-prep",
      "Call prep",
      "Paste what you know about a prospect: a one-page plan for the call.",
      "Preparing for a call...",
      450,
      "Write a one-page prep sheet for a call with the prospect described in what the owner pasted. Give: WHO THEY ARE in two lines, WHAT THEY PROBABLY WANT, 5 QUESTIONS TO ASK in order, THE LIKELY OBJECTION and how to answer it, and THE OUTCOME TO AIM FOR on this call. Work only from what was pasted and the brief: do not invent facts about the prospect.",
      {
        label: "Paste what you know about the prospect",
        placeholder: "Their enquiry, their business, anything from earlier conversations...",
      },
    ),
    extra(
      "lead-reactivate",
      "Wake up old leads",
      "Three messages for people who enquired and never bought.",
      "Waking up old leads...",
      450,
      "Write a 3-message sequence to wake up leads who enquired more than a month ago and never bought. Give each as a text message and as an email (subject and body). Message 1 reopens the conversation without guilt, message 2 offers something new or useful, message 3 is a polite last call. Space them over 10 days and say which day each goes out.",
    ),
    extra(
      "lead-proposal-chase",
      "Proposal follow-up",
      "Four touches for a quote that has gone unanswered.",
      "Chasing a proposal...",
      450,
      "Write the follow-up for a prospect who has been sent a proposal or quote and gone quiet. Give 4 touches over 14 days, mixing email, text and one call. For each: DAY, CHANNEL and the MESSAGE in full. Never write \"just checking in\": each touch gives them a reason to reply.",
    ),
    extra(
      "lead-no-show",
      "No-show recovery",
      "What to send when a booked call is missed.",
      "Recovering a no-show...",
      300,
      "Write what to send when a prospect misses a booked call: a TEXT within 10 minutes, an EMAIL the same day, and a FINAL MESSAGE three days later. Assume good faith, make rebooking one tap with [BOOKING LINK], and keep each under 60 words.",
    ),
  ],

  // -------------------------------------------------------- Budget & ROI ----
  THE_BANKER: [
    core(
      "roi-budget",
      "Budget and lead targets",
      "How to split the spend, and the most a lead can cost.",
      "Setting the ad budget and lead targets...",
      600,
      "Build the budget plan for running Google and Meta ads together, using [MONTHLY AD BUDGET]. Give: THE SPLIT (percentages for Google search, Meta prospecting and Meta retargeting, with one line of reasoning each), THE MATHS as simple formulas using [AVERAGE SALE VALUE], [GROSS MARGIN %] and [CLOSE RATE %] to work out the most a lead can cost and still be worth it, and THE FIRST 30 DAYS (what to expect while campaigns learn, and what not to touch). Do not invent the business's figures. You may add one worked example with round numbers, clearly labelled as an example.",
    ),
    core(
      "roi-rules",
      "Kill-and-scale rules",
      "If-then rules for a 20-minute weekly review.",
      "Writing the weekly kill-and-scale rules...",
      550,
      "Write the rules for a 20-minute weekly ads review. Give: THE 6 NUMBERS TO PULL from Google Ads and Meta Ads Manager and where to find each, KILL RULES (plain if-then rules for pausing a keyword, an ad or an ad set, with thresholds given as multiples of [TARGET COST PER LEAD]), SCALE RULES (when to raise a budget and by how much), and WHAT TO LEAVE ALONE. Finish with a one-page checklist version.",
    ),
    core(
      "roi-report-template",
      "Monthly report template",
      "A results report you can fill in in ten minutes.",
      "Building the monthly results report...",
      500,
      "Build a monthly ad results report the owner can fill in in ten minutes. Give: HEADLINE NUMBERS (spend, leads, cost per lead, booked calls, sales, return on ad spend, each with its formula), BY CHANNEL (the same for Google and for Meta), WHAT WORKED, WHAT DID NOT, and NEXT MONTH'S PLAN (three actions). Use a square-bracket placeholder for every figure.",
    ),
    core(
      "roi-prospect-value",
      "What a prospect is worth",
      "The value of one lead, one call and one sale, as formulas.",
      "Costing a solid prospect...",
      500,
      "Write a plain-English guide to what a solid prospect is worth to this business. Show, with formulas and placeholders, how to get from [AVERAGE SALE VALUE] and [CLOSE RATE %] to the value of one lead, one booked call and one sale, and how lead quality changes the answer: compare a cheap lead that rarely buys with a dearer one that often does. Finish with THE ONE NUMBER TO WATCH each week, and why.",
    ),
    extra(
      "roi-month-report",
      "Write this month's report",
      "Paste the month's numbers: a finished report, working shown.",
      "Writing this month's report...",
      550,
      "Write this month's ad results report from the numbers the owner pasted. Give: THE MONTH IN ONE LINE, HEADLINE NUMBERS (spend, leads, cost per lead, booked calls, sales, return on ad spend), BY CHANNEL, WHAT WORKED, WHAT DID NOT, and NEXT MONTH (three actions). Where a figure needed for a calculation is missing, leave that line as a placeholder and say what is needed.",
      {
        label: "Paste the month's numbers",
        placeholder: "Spend, leads, booked calls, sales and revenue, for Google and for Meta...",
      },
    ),
    extra(
      "roi-cpl-check",
      "Cost per lead check",
      "Paste your numbers: profitable, break-even or losing money.",
      "Checking cost per lead...",
      400,
      "Judge the cost per lead from the numbers the owner pasted. Work out in order: actual cost per lead, the share of leads that become sales, cost per sale, and the most a lead could cost before a sale stops being worth it (from the average sale value and margin given). Give THE VERDICT in one line (profitable, break-even or losing money), then THE ONE LEVER that would move it most. Where a number is missing, say which, and stop there for that step.",
      {
        label: "Paste your numbers",
        placeholder: "Ad spend, leads, sales, average sale value, gross margin...",
      },
    ),
    extra(
      "roi-scenarios",
      "Budget scenarios",
      "Paste current results: hold, grow by half, or double.",
      "Running budget scenarios...",
      500,
      "Build 3 budget scenarios from the current numbers the owner pasted: hold, grow by half, and double. For each show expected leads, expected sales and expected return, assuming cost per lead rises as spend rises. State the assumption you use, and say plainly that it is an assumption and not a forecast. Finish with WHICH TO PICK, and what would have to be true for it to work.",
      {
        label: "Paste your current numbers",
        placeholder: "Monthly spend, leads, cost per lead, close rate, average sale value...",
      },
    ),
    extra(
      "roi-channel-split",
      "Google vs Meta",
      "Paste both channels' numbers: where the next dollar goes.",
      "Comparing Google and Meta...",
      450,
      "Compare Google and Meta from the numbers the owner pasted. For each channel show cost per lead, cost per sale and return on ad spend. Then give: WHERE THE NEXT DOLLAR GOES and why, WHAT WOULD CHANGE YOUR MIND, and how to move budget without resetting what the campaigns have learned.",
      {
        label: "Paste the numbers for both channels",
        placeholder: "For Google and for Meta: spend, leads, sales, revenue...",
      },
    ),
    extra(
      "roi-client-update",
      "Client results email",
      "Paste a client's numbers: a short, straight results email.",
      "Writing a client results email...",
      300,
      "Write a short results email to a client from the numbers the owner pasted. Plain words for someone who does not run ads: what was spent, what it brought in, what changed since last time, what is being done next, and one thing needed from them. Under 200 words, with the three numbers that matter most at the top. Do not dress up a bad month: say it straight, and say what happens next.",
      {
        label: "Paste the client's numbers",
        placeholder: "Client name, period, spend, leads, cost per lead, anything that changed...",
      },
    ),
  ],
};

/** Total skills across the crew, for the feed and the docs. */
export const SKILL_COUNT = Object.values(SKILLS).reduce((sum, list) => sum + list.length, 0);
