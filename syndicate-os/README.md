# SYNDICATE.OS

A command deck for a crew of four AI operatives with one job: bring in solid prospects with paid ads. Dark, sharp-edged, neon.

| Operative | Field | What it produces |
| --- | --- | --- |
| HYPE_BEAST | Meta Ads | Lead campaign build, ad copy, the lead form, retargeting |
| THE_SHADOW | Google Ads | Search campaign build, keywords and negatives, search ads, lead tracking |
| THE_FIXER | Lead Quality | Prospect scorecard, first response, follow-up, discovery call script |
| THE_BANKER | Budget & ROI | Budget split and lead targets, weekly kill-and-scale rules, monthly report |

The crew drafts. It does not log in to Google Ads or Meta Ads Manager, and it does not post, send or spend anything: the operator copies the work to wherever it is going.

This is a standalone app. It lives in the Business OS repository but shares no code, styles or dependencies with it.

## Three ways it runs

| | Simulation | Your own model | Through Claude |
| --- | --- | --- | --- |
| When | No model connected | A model is connected under **MODEL** | Opened as a published Claude artifact |
| What does the thinking | Nothing: a script | Any API you have a key for, or a model on this computer | The viewer's own Claude plan |
| Where work is kept | Nowhere | This browser, on this computer | The artifact's own store |
| The feed | Scripted lines | Only things that happened | Only things that happened |

The dashboard works out which at load. A connected model is remembered, so the next start goes straight to live.

## Connecting a model

**MODEL** in the header opens the connection form: an address, a key if the service needs one, and a model name. **Find models** asks the address what it offers, which doubles as a test that the address and key work.

| Preset | Talks to | Key |
| --- | --- | --- |
| Claude | Anthropic's API, through Anthropic's own SDK | Yes |
| OpenAI | `api.openai.com` | Yes |
| OpenRouter | `openrouter.ai` | Yes |
| Ollama | A model running on this computer (`localhost:11434`) | No |
| LM Studio | A model running on this computer (`localhost:1234`) | No |
| Any other API | Any address that speaks the OpenAI chat-completions format | If it needs one |

Two things to know:

- **Keys are kept in the browser's storage on this computer and are not encrypted.** They are sent only to the address they were entered for. The planned desktop build moves them to the operating system's protected store.
- **A local model can turn the page away.** Opened from a file, a browser page has no address of its own, and Ollama refuses pages it does not recognise unless it is told to allow them (`OLLAMA_ORIGINS=*`). LM Studio has a setting for the same thing. The desktop build removes the problem, because it is not a browser page.

Where the Claude preset uses a model that supports it, a declined request is handed to another model inside the same call, so a false alarm from a safety filter does not cost the job.

## Real work

- **Brief.** The crew works from one business brief: name, what it sells, where, ideal customer, why customers choose it, tone, and any facts worth using. `brief.json` is the brief this copy starts with; the operator's own saved brief replaces it. Nothing runs until there is a name and what the business sells.
- **Skills.** Each operative has four core skills and five or six more it runs on demand: 39 across the crew. Deploy works through the core four in order. **Skills** on a card runs any of them on the spot.
- **Your own data.** Skills marked *needs your data* work on whatever you paste in: a table copied out of Google Ads or Ads Manager, an enquiry, a landing page, a month's numbers. Until the app is connected to the ad accounts, this is how the crew sees real results. The paste is fenced and labelled as material, so text inside it is analysed and never followed as an instruction.
- **Any job you like.** `assign shadow Write 5 more headlines about same-week callouts` hands that operative the job in your own words.
- **Vault.** Finished work is listed under the crew, newest first. Open a piece to read it, copy it or delete it. It is kept across restarts.
- **No invented facts.** Every job tells the model to use only what the brief says and to leave a `[PLACEHOLDER]` where a price, phone number or guarantee is needed but missing. Jobs that would need live data, such as search volumes, say so and do not guess.
- **Usage.** Each job is one call to the model. Auto-requeue is off to begin with, so one deploy is one job. Switched on, it runs to the end of the operative's list and stops. Nothing loops or retries by itself.

## Skills

Core skills are in bold. The rest are on demand; *(data)* marks the ones that work on something pasted in.

| Operative | Skills |
| --- | --- |
| HYPE_BEAST, Meta Ads | **Lead campaign build**, **5 ads**, **Lead form**, **Retargeting**, Performance review *(data)*, Creative test plan, 20 hooks, Audience ideas, Ad policy check *(data)*, Refresh a tired ad *(data)* |
| THE_SHADOW, Google Ads | **Search campaign build**, **Keywords and negatives**, **Responsive search ads**, **Lead tracking setup**, Account audit *(data)*, Search terms clean-up *(data)*, Weekly review *(data)*, Quality Score fixes *(data)*, Landing page check *(data)*, Competitor ad teardown *(data)* |
| THE_FIXER, Lead Quality | **Prospect scorecard**, **5-minute first response**, **7-day follow-up**, **Discovery call script**, Triage a lead *(data)*, Answer an objection *(data)*, Call prep *(data)*, Wake up old leads, Proposal follow-up, No-show recovery |
| THE_BANKER, Budget & ROI | **Budget and lead targets**, **Kill-and-scale rules**, **Monthly report template**, **What a prospect is worth**, Write this month's report *(data)*, Cost per lead check *(data)*, Budget scenarios *(data)*, Google vs Meta *(data)*, Client results email *(data)* |

They cover the same ground as the ad, lead and reporting skills Claude itself can be given (account audits, search-term and wasted-spend reviews, weekly and monthly reporting, ad copy, lead triage, objection handling, follow-up), written fresh for this app. The difference is where the data comes from: Claude's connected skills read an ad account directly, and these work on what the owner pastes in.

To add or change a skill, edit `src/lib/skills.ts`. A skill is a name, a one-line promise, the instruction for the model, a word ceiling, and optionally a label for the paste box.

## Run it

```bash
cd syndicate-os
npm install
npm run dev      # http://localhost:3000
```

`npm run build` makes the production build, `npm run start` serves it, `npm run lint` checks the code.

### One file, no install

```bash
npm run build:standalone
```

writes three files to `dist/`:

| File | What it is |
| --- | --- |
| `SYNDICATE-OS.html` | The whole app in one file. Copy it to any computer and double-click it. Connect a model and it does real work. |
| `syndicate-os.artifact.html` | The same app without the page wrapper, for publishing as a Claude artifact with the capabilities `{ sample: {}, db: {}, user: {} }`. |
| `syndicate-os.demo.html` | Locked to the scripted demo. It never asks for a model or for storage, so it cannot go live wherever it is opened. For showing the deck with nothing real behind it. |

## What you can do

| Action | How |
| --- | --- |
| Deploy or recall an operative | The card's **Deploy / Recall** button, or keys `1`–`4` |
| Wake or stop the whole crew | **Deploy all** and **Kill switch** in the header |
| Connect or change the model | **Model** in the header |
| Change who the crew works for | **Brief** in the header |
| Run one skill now | **Skills** on a card (live only) |
| Tune an operative | **Configure** (the gear, when live): power state, auto-requeue, inject a job |
| Drive it from the keyboard | Press `/` and type. `Tab` completes, `↑` recalls history |
| Read back through the feed | Scroll up. It holds position and counts what you are missing |

### Commands

```
help                            list commands
status                          report on every operative
deploy <operative|all>          put an operative to work
recall <operative|all>          pull an operative back to idle
boot <operative|all>            bring an offline node up to idle
kill <operative|all>            take a node offline
assign <operative> <directive>  inject a directive and deploy
skills [operative]              list what the crew can do
clock <operative> <1-5>         set clock speed (simulation)
brief                           show who the crew is working for
clear                           flush the feed
```

Operatives answer to a name, a fragment or a number: `deploy hype`, `kill 4`, `assign fixer Write a reply to a lead who says it costs too much`.

## How it is built

Next.js (App Router, TypeScript), Tailwind CSS v4, Framer Motion, Lucide icons, and Anthropic's SDK for the Claude connection.

```
brief.json            the business this copy starts out working for
src/
  app/
    layout.tsx        fonts (Inter + JetBrains Mono via next/font), metadata
    page.tsx          the dashboard: header, stats, operative grid, vault, feed
    globals.css       colour tokens, .crt-scanline overlay, glitch-anim keyframes
  components/
    AgentCard.tsx         one operative: status, CURRENT_DIRECTIVE, progress, Deploy / Configure
    TerminalLog.tsx       the feed: auto-scroll, filters, command line
    Vault.tsx             the list of finished work
    DeliverablePanel.tsx  reader for one piece, finished or still being written
    SkillsPanel.tsx       one operative's skills, with a paste box for the ones that need data
    ModelPanel.tsx        connect a model: any API, or one on this computer
    BriefPanel.tsx        the business brief form
    ConfigPanel.tsx       settings for one operative
    Drawer.tsx            the slide-out panel the four above share
    GlitchText.tsx        Framer Motion text tear, rolled fresh on every hover
    Header.tsx  StatStrip.tsx  Sparkline.tsx  BootOverlay.tsx
  lib/
    mock-data.ts      the four operatives and their scripted playbooks
    skills.ts         the 39 real skills: what each asks the model for
    engine.ts         one pure reducer for every mode, plus the command parser
    live.ts           builds the instructions sent to the model; explains failures
    providers.ts      model connections: presets, storage, the chat-completions format
    anthropic.ts      the Claude connection, through Anthropic's SDK
    local-db.ts       the vault and brief, kept in this browser
    host.ts           types for a hosting page's model and storage hooks
    use-live-ops.ts   talks to the model and the store, feeds results to the engine
    use-syndicate.ts  owns the state and the one-second clock
    types.ts          every type in one place
standalone/main.tsx   entry point for the one-file builds
scripts/build-standalone.mjs
```

All behaviour lives in `engine.ts` as a pure reducer. The buttons, the hotkeys and the command line all dispatch the same actions, so they cannot drift apart. Clocks, random numbers and calls to a model happen in the hooks and arrive as actions, which keeps the reducer deterministic and the server-rendered page identical to the first browser render.

Every way of reaching a model is reduced to one function shape (ask a question, stream the answer, report a coded failure), and every store to one document interface. The engine never knows which is behind them, which is what lets the same app run from a file, in Claude, and later as a desktop program.

To change the skills, edit `skills.ts`. To change the rules every skill runs under, edit `buildPrompt` in `live.ts`. To add a connection preset, add it to `PRESETS` in `providers.ts`.

## Not built yet

- **A desktop program.** The plan is a small shell around the one-file build, with an installer. It removes the two limits above: keys go into the operating system's protected store, and local models connect without being told to allow the page.
- **Ad account connections.** Reading results from Google Ads and Meta and pushing changes needs API access granted by each platform to the account owner.

## Design rules

- Void black `#050505`, off-white text `#EAEAEA`, three accents: pink `#FF0055`, acid green `#39FF14`, cyan `#00F0FF`.
- No rounded corners. Monospace for every label, status and number.
- Status is never colour alone: each state has its own label and marker shape.
- Motion is switched off for anyone who asks their system for reduced motion.
