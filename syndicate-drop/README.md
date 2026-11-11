# SYNDICATE.DROP

Pokémon TCG release and restock monitor for Australian retailers, in the SYNDICATE.OS theme.
It watches product pages, texts you and posts to Discord the moment one can be bought, and
keeps a buy/sell ledger so you can see real profit.

It does **not** check out for you, and it does not try to get past retailer bot protection.
Retailers cancel bot orders and enforce per-customer limits; the winning setup is a fast alert
plus a saved account and payment on each retailer, so you check out by hand in about 20 seconds.

```
watchlist ─► monitor (each page every 15–60s) ─► stock goes live ─► SMS + Discord + dashboard beep
                                                                         │
                                                         you tap BUY NOW, check out by hand
                                                                         │
                                                                 log the buy in the ledger
```

## What works where

Checked from a cloud server on 11 Nov 2026:

| Retailer | From a cloud server | Notes |
|---|---|---|
| Target, JB Hi-Fi, Amazon AU | Works | |
| Big W, EB Games, Kmart, Toymate | Blocked (403/429) | Run the monitor from a home internet connection instead (see below) |
| Pokémon Center AU | Expect blocked | Uses a queue system on big drops |

The dashboard shows `BLOCKED` per retailer, so you always know which ones are actually covered.

## Run it

Needs Node 20 or newer. No packages to install.

```
cd syndicate-drop
DASH_PASSWORD=pick-one npm start      # http://localhost:8080, any username
npm test
```

### Settings (environment variables)

| Name | What |
|---|---|
| `DASH_PASSWORD` | Password for the dashboard. Leave empty only on your own computer. |
| `DATA_DIR` | Where the watchlist and ledger are saved. Default `./data`. |
| `DISCORD_WEBHOOK_URL` | Discord: channel settings → Integrations → Webhooks → New Webhook → Copy URL. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | From the Twilio console. |
| `TWILIO_FROM` | Your Twilio number, e.g. `+61400000000`. |
| `ALERT_SMS_TO` | Your mobile number(s), comma-separated, e.g. `+61412345678`. |

### Deploy on Render (hands-off, covers Target, JB Hi-Fi and Amazon)

New → Blueprint → pick this repo. It reads `render.yaml`: Starter plan (about US$7 a month) plus a
1 GB disk. Fill in the Discord and Twilio values when asked. The dashboard password is generated;
find it under the service's Environment tab.

### Run at home (covers Big W, EB Games and Kmart too)

Any always-on Windows PC, Mac or mini PC on your home internet: install Node, then `npm start`
in this folder. Same dashboard at `http://localhost:8080`.

## Using it

1. Open the product page on the retailer's site (pre-release pages usually exist a week or two out).
2. Paste the link, name it, set the release date and how often to check (30s is fine; 15s minimum).
3. Press **TEST ALERT** once to confirm SMS and Discord arrive.
4. Before each drop: log in to each retailer, save your address and card.
5. When the phone buzzes, tap the link and check out.
6. Log the buy in the ledger. When it sells, press **SOLD** and enter price and fees.

If a page reads `UNKNOWN`, add text that only shows when it's in stock (or out) to the item. That
part is in the API (`inStockText`, `outOfStockText`) and not yet on the form.
