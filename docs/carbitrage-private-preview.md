# Private Carbitrage preview

This is not live. No URL in this repository is a private preview.

The published Lovable project `92b962ba-8cbd-4e77-b734-dd01c5a9be50` (workspace `Uz0wd25q1PSmjFga5FsY`) is already public and its ordinary preview uses the existing Supabase database. It is on main `a2d065e6`. It is not this branch, and it was not used.

Lovable has no branch deploy for this PR head. A remix would be a different project. Share links on the current Pro plan are not password gates.

Hostinger shared, cloud, and agency orders are none. VPS `1422435` (`76.13.213.71`) is the live agent host and was not changed. This cloud agent has no verified authenticated port-forward for the dealer app. The agent page is the chat, not the portal. An unguessable public URL would not count as access control.

## What the parent runs

On a separate host. Not the live VPS. Not Supabase.

Needs Node 22 and PostgreSQL 16 listening on `127.0.0.1` only. One inbound TCP port, default `8080`, reachable only on a network the owner already controls. No new paid service.

Do not export the app `.env`. If any `SUPABASE_*`, `VITE_SUPABASE_*`, or `DATABASE_URL` variable is set, or any value contains a Supabase host, startup exits and prints the variable names only.

```sh
# files, mode 0600, localhost URLs only
.carbitrage-local/database-url
.carbitrage-local/migrate-url
```

```sh
CARBITRAGE_ENV=preview CARBITRAGE_DEMO_MODE=1 npm run preview:carbitrage
```

The script writes `.carbitrage-local/preview-gate` if it is missing and prints that path. It does not print the password. Hand the password to the owner through the existing secure channel.

The process listens on `CARBITRAGE_HOST` (default `127.0.0.1`) and `CARBITRAGE_PORT` (default `8787` for the API entry, set `CARBITRAGE_PORT=8080` on the isolated host). Postgres stays on localhost. Every page, demo persona, ingest, and MCP call returns 401 until the preview password sets an httpOnly cookie.

`npm run build:preview` builds the site without the published Supabase URL and exits if `supabase.co` appears in `dist/`.

## Still required from the parent

Nothing here is already reachable from outside this machine. The parent chooses the isolated host and the private path to port `8080`. No connector was added.
