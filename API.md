# REST API (v1)

For Zapier, your website, GoHighLevel webhooks or your own scripts. Base URL: `https://<your APP_URL>/api/v1`.

## Keys

Create keys in **Settings → API keys** (needs `integrations.manage`). Each key:

- works in **one business** only,
- carries its own permission list (never more than the person who created it),
- is shown once; only a sha256 hash is stored,
- can expire and can be revoked instantly,
- appears in the audit log as `API key "<name>"` for everything it changes.

```
Authorization: Bearer bos_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Limits

120 requests per minute per key → `429` with `Retry-After: 60`.

## Errors

Every error has the same shape and a `request_id` (also in the `x-request-id` header) that matches the server log:

```json
{ "error": { "code": "invalid_request", "message": "Some fields are missing or invalid.", "details": [{ "path": "email", "message": "Invalid email address" }] }, "request_id": "a1b2c3d4e5f6" }
```

| Status | code |
|---|---|
| 400 | `invalid_request`, `invalid_json`, `invalid_sort`, `invalid_cursor`, `invalid_reference` |
| 401 | `unauthorized` (missing, wrong, expired or revoked key) |
| 403 | `forbidden` (key lacks the permission) |
| 404 | `not_found` (includes records in other businesses) |
| 409 | `conflict` |
| 429 | `rate_limited` |
| 500 | `server_error` — nothing was saved; quote the `request_id` |

## Lists: pagination, filtering, sorting

- `limit` 1–100 (default 25)
- `sort`: a listed field, `-` prefix for newest/largest first (default `-created_at`)
- `cursor`: pass `next_cursor` from the previous page; `null` means no more

```json
{ "data": [ … ], "next_cursor": "eyJ2IjoiMjAyNi0wOS0yOFQwMToyMzo0NS42NzhaIiwiaWQiOiIuLi4ifQ" }
```

Field names are `snake_case`, money is integer cents (`total_cents: 275000` = $2,750.00), timestamps are ISO-8601 UTC.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1` | any valid key | business, key permissions, endpoint list |
| GET | `/api/v1/contacts` | `contacts.view` | `q` (name/email/phone), `status` (lead/customer/inactive), `tag`, `email`, `include_archived`; sort `created_at`, `updated_at`, `last_name` |
| POST | `/api/v1/contacts` | `contacts.edit` | `name` or `first_name`/`last_name`, `email`, `phone`, `company`, `status`, `tags[]`, `source`, `custom_fields{}` |
| GET | `/api/v1/contacts/{id}` | `contacts.view` | |
| PATCH | `/api/v1/contacts/{id}` | `contacts.edit` | only the fields you send change; `custom_fields` merge |
| GET | `/api/v1/leads` | `sales.view` | `status`, `source` |
| POST | `/api/v1/leads` | `sales.edit` | matches an existing contact by email/phone, creates the lead, fires "New lead" automations |
| GET | `/api/v1/invoices` | `invoices.view` | `status`, `contact_id`; sort `created_at`, `updated_at`, `number`; includes `public_url` (Pay Now link) |
| GET | `/api/v1/invoices/{id}` | `invoices.view` | with `lines` |
| GET | `/api/v1/payments` | `payments.view` | `status`, `invoice_id` |
| GET | `/api/v1/tasks` | `tasks.view` | `status`, `contact_id` |
| POST | `/api/v1/tasks` | `tasks.edit` | `title`, `description`, `due_at` (ISO with offset), `priority`, `contact_id` |
| GET | `/api/v1/jobs` | `jobs.view` | `status`, `contact_id` |
| GET | `/api/v1/calendar.ics` | `calendar.view` | ICS feed of appointments + scheduled jobs (−30 to +180 days). Calendar apps can't send headers, so this one also accepts `?key=` — use a key that has **only** `calendar.view` |

Creating invoices, sending messages and taking payments through the API are deliberately **not** in v1: they're customer-facing and money-moving, so they stay behind a person in the app for now (see ROADMAP.md).

## Examples

```bash
# New lead from a website form (Zapier "Webhooks by Zapier → POST")
curl -X POST https://os.example.com.au/api/v1/leads \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Emma Wilson","phone":"0400 111 222","source":"website","notes":"Wants new doors + benchtop"}'

# Overdue invoices, 50 at a time
curl "https://os.example.com.au/api/v1/invoices?status=overdue&limit=50" -H "Authorization: Bearer $KEY"

# Next page
curl "https://os.example.com.au/api/v1/invoices?status=overdue&limit=50&cursor=$NEXT" -H "Authorization: Bearer $KEY"
```

## Inbound webhooks (not API-key based)

| URL | Verified by |
|---|---|
| `/api/webhooks/stripe/{integrationId}` | Stripe signature (per business signing secret); idempotent by event id |
| `/api/webhooks/twilio/{integrationId}` | Twilio request signature |
| `/api/webhooks/website/{integrationId}?token=…` | per-integration token (constant-time compare), rate limited |

## Internal endpoints (the app itself)

`/api/assistant`, `/api/assistant/confirm`, `/api/documents` use the session cookie and must come from the app's own origin (CSRF check in `src/proxy.ts`). They're not a public API.

## Implementation

`src/server/api/v1.ts` (`apiRoute(permission, handler)`: key lookup via `app.auth_api_key`, rate limit, permission, pinned transaction, error mapping, keyset pagination), `src/server/api/serialize.ts` (public shapes), routes in `src/app/api/v1/`. Tests: `tests/api.test.ts`.
