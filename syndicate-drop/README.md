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
From a home internet connection, they treat the monitor like any visitor.
JB Hi-Fi loads stock after the page opens, so its pages read `UNKNOWN`; Target, Kmart, Big W, EB Games and Amazon AU publish stock in the page itself. If a page still shows
`BLOCKED`, the monitor backs off for 5 minutes and the daily brief lists it.

## Telegram: run everything from your phone

| Command | Does |
|---|---|
| `/brief` `/upcoming` `/live` `/orders` | Updates on demand |
| `/list` | Watchlist with short #ids |
| `/watch <link> [YYYY-MM-DD] [max$]` | Watch a product page |
| `/calendar <YYYY-MM-DD> <name>` | Release date only (reminders, brief) |
| `/check` `/pause` `/resume` `/remove` `#id` | Manage a watched product |
| `/bought <qty> <$each> <name>` | Log a buy |
| `/shipped #id [eta] [tracking]` · `/delivered #id` · `/sold #id <$each> [fees$]` | Move an order along |

Also sent to Telegram: drop alerts, the daily brief, release reminders, order changes made on the
dashboard, a once-a-day notice when a product page is blocked or broken, and scout finds.

## Pre-order scout

A scheduled cloud task searches Australian retailers twice a week for new pre-order pages and posts
them to a private ntfy.sh topic (free, no account). The program checks that topic every 5 minutes and
sends each find to Telegram with **➕ WATCH** / **✕ SKIP** buttons. Only known retailer links are
accepted, nothing is added without your tap, and the topic name is baked in at build time
(`SD_RELAY_TOPIC=… npm run build:exe`), never committed.

The bot only answers the chat that pressed Start first. Everyone else is ignored.

## Ledger

Log each buy with status (ORDERED / SHIPPED / DELIVERED), ETA and tracking. Press 🚚 SHIPPED and
📦 DELIVERED as it moves; each change pings Telegram. Press **SOLD** with sale price and fees to see
real profit. Orders past their ETA show as OVERDUE in the brief.

## Developers

Node 20+; no runtime dependencies.

```
npm start              # run from source (data in ./data)
npm test               # 24 tests
npm run build:exe      # dist/SyndicateDrop-Windows.zip (needs nodejs.org, npm, zip/unzip)
npm run build:linux    # dist/build/SyndicateDrop for testing
```

Env overrides: `PORT` (default 8080), `DATA_DIR`, `NO_BROWSER=1`, `DASH_PASSWORD`. The dashboard
listens on 127.0.0.1 only.

See `WHOLESALE.md` for sourcing at cost.
