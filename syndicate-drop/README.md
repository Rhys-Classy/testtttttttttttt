# SYNDICATE.DROP

A downloadable Pokémon TCG drop monitor for Australian retailers, in the SYNDICATE.OS theme.
It runs on your own PC, watches product pages, and has a Telegram bot that keeps you updated.
No paid services.

```
SyndicateDrop.exe on your PC
  ├─ monitor: checks each product page every 15–60s
  ├─ Telegram bot ─► drop alerts (instant)
  │                ─► daily brief: releases in 14 days · live stock · orders on the way · unsold stock · profit
  │                ─► reminders: evening before release, and release morning
  │                ─► order updates: shipped / delivered
  │                ◄─ /brief /upcoming /orders /live
  └─ dashboard (http://localhost:8080): watchlist · ledger · settings
```

It does **not** check out for you and does not try to get past retailer bot protection. Retailers
cancel bot orders and enforce per-customer limits. The winning setup is a fast alert plus a saved
account and card on each retailer, so you check out by hand in about 20 seconds.

## Get it running (Windows)

1. Download `SyndicateDrop-Windows.zip`, unzip it somewhere permanent.
2. Double-click `SyndicateDrop.exe`. If Windows says "protected your PC": More info → Run anyway.
3. The dashboard opens and shows the Telegram setup:
   - Telegram → search **@BotFather** → `/newbot` → copy the token → paste it → **CONNECT BOT**
   - Open your new bot and press **Start**
4. Paste product links into the watchlist, with release dates.

`START HERE.txt` in the zip also covers starting automatically with Windows and stopping the PC sleeping.

## Why a home PC

Big W, EB Games, Kmart and Toymate block requests from cloud servers (checked 11 Nov 2026).
From a home internet connection, they treat the monitor like any visitor. If a page still shows
`BLOCKED`, the monitor backs off for 5 minutes and the daily brief lists it.

## Telegram commands

| Command | Reply |
|---|---|
| `/brief` | The full daily brief now |
| `/upcoming` | Releases in the next 14 days |
| `/orders` | Orders on the way, with ETA, tracking and overdue flags |
| `/live` | What's buyable right now, with links |

The bot only answers the chat that pressed Start first. Everyone else is ignored.

## Ledger

Log each buy with status (ORDERED / SHIPPED / DELIVERED), ETA and tracking. Press 🚚 SHIPPED and
📦 DELIVERED as it moves; each change pings Telegram. Press **SOLD** with sale price and fees to see
real profit. Orders past their ETA show as OVERDUE in the brief.

## Developers

Node 20+; no runtime dependencies.

```
npm start              # run from source (data in ./data)
npm test               # 19 tests
npm run build:exe      # dist/SyndicateDrop-Windows.zip (needs nodejs.org, npm, zip/unzip)
npm run build:linux    # dist/build/SyndicateDrop for testing
```

Env overrides: `PORT` (default 8080), `DATA_DIR`, `NO_BROWSER=1`, `DASH_PASSWORD`. The dashboard
listens on 127.0.0.1 only.

See `WHOLESALE.md` for sourcing at cost.
