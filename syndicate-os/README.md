# SYNDICATE.OS

A command deck for a crew of AI operatives that cover marketing, lead gen, support and finance. Dark, sharp-edged, neon.

It runs in one of two modes and works out which at load:

| | Simulation | Live |
| --- | --- | --- |
| When | Run locally, or opened from the one-file copy | Opened through Claude, as a published artifact |
| What operatives do | Act out a script | Send each job to Claude and file what comes back |
| The feed | Scripted lines | Only things that happened |
| Needs | Nothing | A business brief |

This is a standalone app. It lives in the Business OS repository but shares no code, styles or dependencies with it.

## Live mode: real work

Opened through Claude, the page asks its host for two things: a way to ask Claude a question, and a small document store. If it gets the first, the demo crew is swapped for a real one before anything pretend reaches the screen.

- **Brief.** The crew works from one business brief: name, what it sells, where, ideal customer, why customers choose it, tone, and any facts worth using. Nothing runs until the name and what it sells are filled in.
- **Jobs.** Each operative has five real jobs (video scripts, ads, follow-up sequences, review responses, a marketing budget and so on). Deploy starts the next one.
- **Any job you like.** `assign hype Write 3 ads for our winter offer` hands that operative the job in your own words.
- **Vault.** Finished work is listed under the crew, newest first. Open a piece to read it, copy it or delete it. It is kept across visits.
- **No invented facts.** Every job tells Claude to use only what the brief says and to leave a `[PLACEHOLDER]` where a price, phone number or guarantee is needed but missing.
- **Usage.** Each job is one call on the viewer's own Claude allowance. Auto-requeue is off to begin with, so one deploy is one job. Switched on, it runs to the end of the operative's list and stops. Nothing loops or retries by itself.

Live mode drafts. It does not post, send or publish anything: the operator copies the work to wherever it is going.

To publish it, run `npm run build:standalone` and publish `dist/syndicate-os.artifact.html` as an artifact with the capabilities `{ sample: {}, db: {}, user: {} }`.

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

writes `dist/SYNDICATE-OS.html`: the whole dashboard in a single file, with the script, styles and fonts inside it. Copy it to any computer and double-click it. It needs no Node, no server and no internet connection.

## What you can do

| Action | How |
| --- | --- |
| Deploy or recall an operative | The card's **Deploy / Recall** button, or keys `1`–`4` |
| Wake or stop the whole crew | **Deploy all** and **Kill switch** in the header |
| Tune an operative | **Configure**: power state, clock speed, verbosity, auto-requeue, inject a directive |
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
clock <operative> <1-5>         set clock speed
clear                           flush the feed
```

Operatives answer to a name, a fragment or a number: `deploy hype`, `kill 4`, `assign fixer Refund order 9912`.

## How it is built

Next.js (App Router, TypeScript), Tailwind CSS v4, Framer Motion, Lucide icons.

```
src/
  app/
    layout.tsx        fonts (Inter + JetBrains Mono via next/font), metadata
    page.tsx          the dashboard: header, stats, operative grid, feed
    globals.css       colour tokens, .crt-scanline overlay, glitch-anim keyframes
  components/
    AgentCard.tsx         one operative: status, CURRENT_DIRECTIVE, progress, Deploy / Configure
    TerminalLog.tsx       the feed: auto-scroll, filters, command line
    Vault.tsx             live: the list of finished work
    DeliverablePanel.tsx  live: reader for one piece, finished or still being written
    BriefPanel.tsx        live: the business brief form
    ConfigPanel.tsx       settings for one operative
    Drawer.tsx            the slide-out panel the three above share
    GlitchText.tsx        Framer Motion text tear, rolled fresh on every hover
    Header.tsx  StatStrip.tsx  Sparkline.tsx  BootOverlay.tsx
  lib/
    mock-data.ts      the four operatives: scripted playbooks and real job lists
    engine.ts         one pure reducer for both modes, plus the command parser
    live.ts           builds the instructions sent to Claude; explains failures
    host.ts           types for the hosting page's Claude and storage hooks
    use-live-ops.ts   live: talks to Claude and the store, feeds results to the engine
    use-syndicate.ts  owns the state and the one-second clock
    types.ts          every type in one place
standalone/main.tsx   entry point for the one-file build
scripts/build-standalone.mjs
```

All behaviour lives in `engine.ts` as a pure reducer. The buttons, the hotkeys and the command line all dispatch the same actions, so they cannot drift apart. Clocks, random numbers and calls to Claude happen in the hooks and arrive as actions, which keeps the reducer deterministic and the server-rendered page identical to the first browser render.

To change the scripted demo or the real job lists, edit `mock-data.ts`. To change what Claude is told, edit `buildPrompt` in `live.ts`. To run live mode somewhere other than a Claude artifact, give `use-live-ops.ts` a different way to ask a model a question and keep the reducer.

## Design rules

- Void black `#050505`, off-white text `#EAEAEA`, three accents: pink `#FF0055`, acid green `#39FF14`, cyan `#00F0FF`.
- No rounded corners. Monospace for every label, status and number.
- Status is never colour alone: each state has its own label and marker shape.
- Motion is switched off for anyone who asks their system for reduced motion.
