# Carbitrage standalone portal (draft)

This is a local dealer portal inside the existing auction-edge app. It does not replace Ooglecars, and it does not write to the linked Supabase project.

Open the preview at `/portal` after both processes are running:

```sh
CARBITRAGE_DEMO_MODE=1 npm run carbitrage:server
npm run dev
```

The API listens on `127.0.0.1:8787`. Vite proxies `/api/carbitrage` and `/mcp` to it. Demo mode seeds labelled synthetic yards into `.carbitrage-local/store.json` (gitignored). Delete that folder to reseed.

## What the preview account can do

- Sign in with an httpOnly session. The demo buttons call the server persona map. They do not put an API key in the browser.
- Patrick Auto is a standalone franchise yard with no Ooglecars yard id.
- KTMG North sees only North. The group principal sees North and South because both memberships exist. A user titled group admin on North alone does not see South.
- Finds, detail, DNA, alerts, insights and a Pentana-shaped CSV import (`pentana_sales_csv_v1`) read and write the same local store.
- Green is used only for the “% under floor” figure. Floors are ex-government-charges and carry a source and date. Missing variant evidence leaves the floor blank.

## MCP

`POST /mcp` is JSON-RPC for `initialize`, `tools/list`, `tools/call` and `ping`.

Every request needs `Authorization: Bearer <key>`. Create the key while signed in at `/portal/connect`. It is shown once and is not stored in `localStorage`.

Tools: `list_finds`, `get_find`, `get_yard_profile`, `get_insights`, `update_find_workflow`.

There is no anonymous write, no seller message, bid, booking or payment tool. A `yardId` argument is accepted only when the key’s memberships already include it.

Ingest is separate: `POST /api/carbitrage/ingest` with an ingest token bound to a yard list. Retries of the same `sourceSystem` + `externalId` return the original row. AutoGrab URLs are rejected. The raw envelope is kept on the row.

## Environment

| Name | Purpose |
| --- | --- |
| `CARBITRAGE_DEMO_MODE` | `1` enables synthetic seed and the persona buttons. Leave unset outside a private preview. |
| `CARBITRAGE_DEMO_PASSWORD` | Password login for the seeded users. Local default is `demo-only` when demo mode is on and this is unset. |
| `CARBITRAGE_SESSION_SECRET` | HMAC secret for the session cookie. A local file is created if unset. |
| `CARBITRAGE_DATA_FILE` | JSON file for the local store. |
| `CARBITRAGE_PORT` | API port. Default `8787`. |
| `CARBITRAGE_WRITE_LOCAL_SECRETS` | `1` writes the ingest token to `.carbitrage-local/ingest-token` mode `0600`. |

## Not done

- The draft SQL in `supabase/drafts/20261106_carbitrage_standalone.sql` has not been applied. Do not copy it into `supabase/migrations`. Row level security in that file has not been executed.
- No production OAuth, public MCP URL, DNS change, or billing. `www.carbitrage.com.au` is unchanged.
- No live VPS bridge, Pentana connection, Manheim login, rego/PPSR lookup, or dealer email.

```sh
npm run test:carbitrage
npm run typecheck
npm run build
```
