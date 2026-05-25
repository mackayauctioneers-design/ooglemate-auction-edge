# Dealer Activation Pipeline

Carbitrage's activation pipeline is split across three systems:

```
Lovable Hub (UI)  ──▶  Supabase Edge Functions  ──▶  VPS Worker API  ──▶  Supabase (canonical tables)
```

- **Lovable** is the steering wheel. UI + auth only.
- **Supabase Edge Functions** are thin, authenticated proxies. They hold
  `WORKER_TOKEN` but never the service role.
- **VPS Worker API** (`/worker-api`) holds `SUPABASE_SERVICE_ROLE_KEY`
  and runs the Python pipeline.
- **Supabase** is the shared data layer. Every dashboard reads canonical
  tables filtered by `dealer_id`.

## Edge functions (proxies)

| Edge function           | Method | Forwards to                              |
|-------------------------|--------|------------------------------------------|
| `activate-dealer`       | POST   | `POST  /activate-dealer`                 |
| `run-dealer-scoring`    | POST   | `POST  /run-dealer-scoring`              |
| `sync-opportunities`    | POST   | `POST  /sync-opportunities`              |
| `dealer-health`         | GET    | `GET   /dealer-health/{dealer_id}`       |

All proxies require an authenticated Supabase user. Authorization rules:

- `admin` role → may invoke for any `dealer_id`.
- Dealer user → may invoke only for `dealer_profiles.account_id == dealer_id`.

Every dispatch is logged to `worker_runs` (request payload, response,
HTTP status, duration, invoking user).

## Required configuration

### Lovable Cloud secrets

| Secret              | Holder      | Notes                                                      |
|---------------------|-------------|------------------------------------------------------------|
| `WORKER_API_URL`    | Edge funcs  | e.g. `https://workers.carbitrage.com.au` (no trailing `/`) |
| `WORKER_TOKEN`      | Edge funcs  | Shared secret with VPS. Must match.                        |

### VPS `.env`

| Var                          | Notes                                            |
|------------------------------|--------------------------------------------------|
| `SUPABASE_URL`               | Project URL                                      |
| `SUPABASE_SERVICE_ROLE_KEY`  | Service role. **VPS only.** Never to Lovable.    |
| `WORKER_TOKEN`               | Must match the value set in Lovable Cloud.       |
| `PORT`                       | Default `8080`.                                  |

## Canonical tables (single source of truth)

| Concept             | Table                  | Dealer key            |
|---------------------|------------------------|-----------------------|
| Sales truth         | `vehicle_sales_truth`  | `account_id`          |
| Fingerprints        | `dealer_fingerprints`  | `dealer_profile_id`   |
| Mandates            | `active_mandates`      | `account_id`          |
| Live market         | `vehicle_listings`     | shared                |
| Opportunities       | `mandate_feed_items`   | `dealer_id`           |
| Worker audit        | `worker_runs`          | `dealer_id`           |

No parallel tables exist. Any `dealer_sales` / `dealer_mandates` /
`dealer_opportunities` naming in API contracts is purely cosmetic —
storage stays canonical.

## Calling from the frontend

```ts
import { useActivateDealer, useRunDealerScoring } from "@/hooks/useDealerWorker";

const activate = useActivateDealer();
activate.mutate(dealerId);   // dealerId is the selected account.id
```

## Deploying the VPS worker

See `worker-api/README.md` for the systemd unit example and reverse-proxy
hint. Point DNS for `workers.carbitrage.com.au` at the VPS once the
service is live, then update `WORKER_API_URL` in Lovable Cloud secrets if
the hostname changes.

## Non-negotiable rules

- The browser never receives `WORKER_TOKEN`.
- Lovable never receives `SUPABASE_SERVICE_ROLE_KEY`.
- Every action is scoped by `dealer_id`. No fallbacks. No defaults.
- No dealer-specific code paths anywhere.
- Dealer Radar and Trading Desk continue to read canonical Supabase
  tables filtered by the selected `dealer_id`. The worker only writes;
  it never owns the read path.
