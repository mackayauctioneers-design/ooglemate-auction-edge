# Carbitrage Worker API

Reference Python FastAPI service intended to run on the VPS. It is the
**only** component that holds the Supabase `service_role` key. Lovable Edge
Functions call this service over HTTPS using a shared `WORKER_TOKEN`.

```
Browser
  │  (Supabase JWT)
  ▼
Supabase Edge Function  (activate-dealer / run-dealer-scoring / ...)
  │  (Bearer WORKER_TOKEN)
  ▼
VPS Worker API  (this service)
  │  (service_role)
  ▼
Supabase  (canonical tables only)
```

## Architecture rules

- The browser never receives `WORKER_TOKEN`.
- Lovable never receives `SUPABASE_SERVICE_ROLE_KEY`.
- Every endpoint requires `dealer_id`. There is no fallback to a global
  or "default" dealer.
- No dealer-specific code paths (no Patrick, no Mackay hardcoding).
- All writes go to the canonical tables:
  - `vehicle_sales_truth`
  - `dealer_fingerprints`
  - `active_mandates`
  - `vehicle_listings`
  - `mandate_feed_items`
- The `worker_runs` audit log is written by the Lovable proxy.

## Endpoints

| Method | Path                          | Purpose                                                       |
|--------|-------------------------------|---------------------------------------------------------------|
| POST   | `/activate-dealer`            | Recompute fingerprints → generate mandates → first match run  |
| POST   | `/run-dealer-scoring`         | Score current `vehicle_listings` against this dealer          |
| POST   | `/sync-opportunities`         | Refresh `mandate_feed_items` for this dealer                  |
| GET    | `/dealer-health/{dealer_id}`  | Row counts + last-run timestamps per canonical table          |

All POST bodies: `{"dealer_id": "<uuid>"}`.
All endpoints require `Authorization: Bearer <WORKER_TOKEN>`.

## Environment

Copy `.env.example` to `.env` on the VPS and fill in:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # service role, VPS ONLY
WORKER_TOKEN=<long random secret>   # must match the value Lovable holds
PORT=8080
```

## Local run

```bash
cd worker-api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in
uvicorn app.main:app --reload --port 8080
```

## Deploy (systemd example)

```ini
# /etc/systemd/system/carbitrage-worker.service
[Unit]
Description=Carbitrage Worker API
After=network.target

[Service]
WorkingDirectory=/opt/carbitrage/worker-api
EnvironmentFile=/opt/carbitrage/worker-api/.env
ExecStart=/opt/carbitrage/worker-api/.venv/bin/uvicorn app.main:app \
  --host 0.0.0.0 --port 8080 --workers 2
Restart=always
User=carbitrage

[Install]
WantedBy=multi-user.target
```

Front the service with nginx/Caddy on `https://workers.carbitrage.com.au`
and point the Lovable `WORKER_API_URL` secret at that hostname.

## Wiring the Python pipeline

The existing Python ingestion/scoring pipeline should be imported as
modules under `app/pipelines/` and called from the handlers in
`app/main.py`. The handlers in this scaffold contain dealer-scoped TODOs
showing exactly where each pipeline step plugs in.

SQLite is acceptable as a transient worker cache. The final source of
truth for Lovable is always Supabase. Never let SQLite become the
authoritative store.
