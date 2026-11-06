# Carbitrage standalone portal (draft)

This is a local dealer portal inside the existing auction-edge app. It does not replace Ooglecars, and it does not write to the linked Supabase project.

Open the preview at `/portal` after both processes are running:

```sh
CARBITRAGE_DEMO_MODE=1 npm run carbitrage:server
npm run dev
```

The API listens on `127.0.0.1:8787` and stores rows in local Postgres (`CARBITRAGE_DATABASE_URL`, app role, and `CARBITRAGE_MIGRATE_URL` for schema/seed). Both URLs must be on localhost. A Supabase host is refused. Vite proxies `/api/carbitrage` and `/mcp`. Demo mode also requires `CARBITRAGE_ENV=local`. Delete the local database and restart to reseed.

## What the preview account can do

- Sign in with an httpOnly session. The demo buttons call the server persona map. They do not put an API key in the browser.
- Patrick Auto is a standalone franchise yard with no Ooglecars yard id.
- KTMG North sees only North. The group principal sees North and South because both memberships exist. A user titled group admin on North alone does not see South.
- Finds, detail, DNA, alerts, insights and a Pentana-shaped CSV import (`pentana_sales_csv_v1`) read and write the same local store.
- Green is used only for the “% under floor” figure. That floor is the median of this yard’s own recent sales of the same variant, recorded ex-government charges. If those sales do not exist, no floor is shown. Wikimedia photos are labelled illustrative, not the listed vehicle.

## MCP

`POST /mcp` is JSON-RPC for `initialize`, `tools/list`, `tools/call` and `ping`.

Production calls send `Authorization: Bearer` with a Supabase-compatible HS256 access token. `SUPABASE_JWT_SECRET` verifies it. The `sub` claim is the user. Yards come from `carbitrage_memberships` under row-level security. A caller-supplied membership or yard id is not authority.

`cbk_` keys and persona buttons work only when `CARBITRAGE_DEMO_MODE=1` and `CARBITRAGE_ENV=local`. They are rejected otherwise. A local bearer smoke test is not a hosted ChatGPT, Claude or Grok connection.

`GET /.well-known/oauth-protected-resource` returns `configured: false` until `CARBITRAGE_OAUTH_ISSUER` and `CARBITRAGE_OAUTH_RESOURCE_URL` are set. Those are not registered here.

Tools: `list_finds`, `get_find`, `get_yard_profile`, `get_insights`, `update_find_workflow`.

There is no anonymous write, no seller message, bid, booking or payment tool. A `yardId` argument is accepted only when the signed-in memberships already include it.

Ingest is separate: `POST /api/carbitrage/ingest` with an ingest token bound to a yard list. Retries of the same `sourceSystem` + `externalId` return the original row. AutoGrab URLs are rejected. The raw envelope is kept on the row.

## Environment

| Name | Purpose |
| --- | --- |
| `CARBITRAGE_ENV` | Must be `local` before demo shortcuts turn on. |
| `CARBITRAGE_DEMO_MODE` | `1` with `CARBITRAGE_ENV=local` enables synthetic seed and persona buttons. |
| `CARBITRAGE_DEMO_PASSWORD` | Password for seeded demo users. Local default is `demo-only` only in that demo mode. |
| `CARBITRAGE_SESSION_SECRET` | HMAC secret for the session cookie. A local file is created if unset. |
| `CARBITRAGE_DATABASE_URL` | Local app role URL. Refuses Supabase and non-local hosts. |
| `CARBITRAGE_MIGRATE_URL` | Local superuser URL used only to apply the draft schema and seed. |
| `SUPABASE_JWT_SECRET` | Verifies production access tokens. Unset means JWT login is rejected. |
| `CARBITRAGE_OAUTH_ISSUER` | Hosted authorization server. Unset means OAuth discovery is not configured. |
| `CARBITRAGE_OAUTH_RESOURCE_URL` | Public MCP resource URL. Unset means OAuth discovery is not configured. |
| `CARBITRAGE_PORT` | API port. Default `8787`. |

## Not done

- The draft SQL is executed only against disposable local Postgres. Do not copy it into `supabase/migrations` or the linked project.
- Hosted OAuth registration, a public MCP URL, and DNS for `www.carbitrage.com.au` are not done.
- No live VPS bridge, Pentana connection, Manheim login, rego/PPSR lookup, or dealer email.

```sh
npm run test:carbitrage
npm run typecheck
npm run build
```
