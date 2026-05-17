
## Strict Outward Search v3 — Dealer-Safe Federated Search

Builds on the existing v2 engine (`run-outward-search-v2`, `_shared/outward-search/*`, `taxonomy/normalizeVehicleIdentity`) rather than replacing it. Adds a strict intent parser, deterministic gating, candidate classifier, and an operator debug view. AI (Gemini via Lovable AI Gateway) is used only for extraction/normalization on messy raw text — never as match authority.

### Architecture (3 layers, federated)

```text
                ┌─────────────────────────────────────────┐
 user query →   │ strict-intent-parser (regex + Gemini    │
                │ with low-temp + uncertainty flags)      │
                └────────────────┬────────────────────────┘
                                 ▼
                ┌─────────────────────────────────────────┐
                │ federated-search orchestrator           │
                │  L1 internal index (market/retail/vehicle_listings)
                │  L2 operator/shadow (AutoGrab — hidden provenance)
                │  L3 outward live (Carsales, Autotrader,  │
                │     Gumtree, EasyAuto123, dealer sites)  │
                └────────────────┬────────────────────────┘
                                 ▼
                ┌─────────────────────────────────────────┐
                │ candidate-normalizer (taxonomy + opt    │
                │ Gemini extraction on raw text only)     │
                └────────────────┬────────────────────────┘
                                 ▼
                ┌─────────────────────────────────────────┐
                │ deterministic gates                     │
                │  make / model-family / generation /     │
                │  body / variant / year                  │
                └────────────────┬────────────────────────┘
                                 ▼
                ┌─────────────────────────────────────────┐
                │ classifier → exact_match | near_match | │
                │ ambiguous | rejected (+reason codes)    │
                └────────────────┬────────────────────────┘
                                 ▼
              dealer UI: exact + safe near_match only
              operator debug: all buckets + rule trace
```

### Files to create

| File | Purpose |
|---|---|
| `supabase/functions/_shared/outward-search/strict-intent.ts` | Hybrid regex-first / Gemini-fallback parser → `StrictIntent` with per-field confidence + `ambiguous_tokens[]` |
| `supabase/functions/_shared/outward-search/normalize-candidate.ts` | Maps any source row (internal/AutoGrab/scraped) to canonical `NormalizedCandidate` shape using `normalizeVehicleIdentity` |
| `supabase/functions/_shared/outward-search/gates.ts` | Deterministic gate functions: `gateMake`, `gateModelFamily`, `gateGeneration`, `gateBody`, `gateVariant`, `gateYear`. Each returns `{ passed, reason_code }` |
| `supabase/functions/_shared/outward-search/classifier.ts` | Runs all gates → `{ bucket, confidence_score, rules_fired[], rejection_reason }` |
| `supabase/functions/_shared/outward-search/gemini-extract.ts` | Constrained Gemini extraction (low temp, JSON schema, ONLY allowed to fill missing fields from raw text; never overrides confirmed taxonomy hits) |
| `supabase/functions/_shared/outward-search/adapters/autograb.ts` | Layer 2 adapter — strips provenance for dealer-facing output |
| `supabase/functions/federated-search/index.ts` | New entrypoint — orchestrates L1→L2→L3 with strict gating; persists run + per-candidate decisions to `outward_search_decisions` |
| `supabase/functions/_shared/outward-search/banned-substitutions.ts` | Hard-coded reject pairs: WRX↔Forester, LC300↔Prado, LC300↔LC200, Tiguan↔Touareg, Silverado↔Sierra, sedan↔wagon when body specified, etc. |

### Files to modify

| File | Change |
|---|---|
| `supabase/functions/run-outward-search-v2/index.ts` | Wire through new gating layer before returning results (back-compat) |
| `_shared/outward-search/adapters/internal-db.ts` | Emit raw `source_class` + body/series fields needed by gates |
| `src/lib/api/ooglebot.ts` / `OogleBotSearch.tsx` | Call `federated-search` endpoint; render bucketed UI: Exact / Likely / Hidden ambiguous link |
| `src/pages/operator/...` | Add `OperatorSearchDebugPage` reading `outward_search_decisions` |

### DB migration

```sql
create table public.outward_search_decisions (
  id uuid primary key default gen_random_uuid(),
  search_run_id uuid references outward_search_runs(id) on delete cascade,
  source text not null,
  layer text not null check (layer in ('internal','shadow','outward')),
  raw jsonb not null,
  normalized jsonb,
  bucket text not null check (bucket in ('exact_match','near_match','ambiguous','rejected')),
  confidence_score numeric,
  rules_fired text[] default '{}',
  rejection_reason text,
  ai_assisted boolean default false,
  created_at timestamptz default now()
);
alter table public.outward_search_decisions enable row level security;
create policy "operators read all" on public.outward_search_decisions
  for select to authenticated using (has_role(auth.uid(),'admin'));
```

### How deterministic gating works

Each candidate runs through gates in order. **First failure = rejected** with a reason code from this fixed set:

`wrong_make` · `wrong_model_family` · `banned_substitution` · `wrong_generation` · `wrong_body` · `variant_conflict` · `year_out_of_tolerance` · `insufficient_identity_confidence` · `missing_required_fields`

Gates are pure functions over `(intent, candidate)`. No AI calls inside gates.

- **Make**: exact equality after `normalizeVehicleIdentity.make_canonical`
- **Model family**: exact equality on `family_key` from `taxonomy_models`; cross-checked against `banned-substitutions.ts`
- **Generation**: uses existing `extractSeries` / `valo-series-generation-gate`; if intent has series → candidate must match or be unknown-but-year-compatible; mismatch = reject
- **Body**: only enforced if intent body is non-null; uses taxonomy body keys (wagon, sedan, ute, suv, hatch, coupe)
- **Variant**: token-boundary match (re-uses `badgeMatchesVariant` from v2); substring fallback never reaches dealer UI
- **Year**: exact when intent specifies single year; ±1 only if confidence < HIGH

### How Gemini is constrained

- Model: `google/gemini-3-flash-preview` via Lovable AI Gateway (`X-Lovable-AIG-SDK: vercel-ai-sdk`)
- Two narrow jobs only:
  1. **Intent extraction fallback** — when regex parser confidence < 0.7. JSON schema output (Zod via AI SDK `Output.object`). Required to return `ambiguous_tokens[]` for anything it could not resolve.
  2. **Raw listing field extraction** — only fields missing after deterministic parse. Returns `{ field, value, source_snippet, model_confidence }`. Output is fed back into normalizer; **never** bypasses gates.
- System prompt explicitly forbids inventing model/variant names; instructs to return `null` + add to `ambiguous_tokens` when unsure.
- `temperature: 0`, response validated against schema, ai_assisted flag stamped on candidate.

### How ambiguous queries are handled

If parser yields `ambiguous_tokens.length > 0` OR top-level confidence < 0.6:
1. Frontend shows a clarification chip strip ("Did you mean: WRX sedan / WRX Sportswagon / Levorg?") built from `taxonomy_models` aliases.
2. If dealer proceeds anyway, search runs in **constrained mode**: only L1 + L2, no outward live calls; results explicitly flagged `low_confidence_query`.

### Operator vs dealer-facing

| Surface | Shows |
|---|---|
| Dealer UI (`OogleBotSearch`) | `exact_match` always; `near_match` if confidence ≥ 75; AutoGrab provenance stripped; no rejection reasons visible |
| Operator debug page | All 4 buckets, raw + normalized JSON, rules fired, AI-assist flag, source provenance intact |

### Rollout

1. Migration + new shared modules (no behaviour change yet)
2. Deploy `federated-search` edge function alongside v2 (dark)
3. Add feature flag `use_federated_search` (per-account); test on Mackay Traders
4. Cut frontend `OogleBotSearch` to new endpoint when flag on
5. Add operator debug page
6. Flip flag globally; deprecate v2 entry after 7-day clean window

### Reusing current code

- `normalizeVehicleIdentity` + taxonomy tables (identity governance rule already enforces single source)
- `extractSeries` / generation gate (LC300/LC200/Prado etc. — already in `ooglebot-search` and `valo`)
- `badgeMatchesVariant` token-boundary matcher from v2
- `outward_search_runs` telemetry table
- Quota / global cap in `_shared/outward-search/quota.ts`
- Lovable AI Gateway helper pattern (per `ai-sdk-lovable-gateway` knowledge)

### Risks / assumptions

- AutoGrab adapter assumes the existing `autograb_listings` ingestion table is current; if stale, L2 will under-perform.
- Outward live scraping (L3) for new sites beyond Carsales/Autotrader needs the worker-fetch pattern from the recently shipped `worker-star-watch-browser`; reusing that fetch+JSON-LD parser keeps surface area small.
- Banned-substitution list is hand-maintained; will need operator UI later (out of scope for this round).
- Gemini extraction adds ~400ms per messy listing — capped to top 20 candidates per source.

### Unclear in current code (flagged during exploration)

- `run-outward-search-v2/dispatchLoop.ts` still enqueues Lindy browse tasks via `outward_browse_queue` — needs to either be repointed at the new internal worker or left in place as a fallback. Plan: leave untouched this round, federated-search uses direct adapters only.
- `ooglebot-search` already does some series gating client-side and server-side; we'll consolidate into the new `gates.ts` so there's one source of truth.

### Order of implementation

1. Migration (`outward_search_decisions`)
2. `banned-substitutions.ts`, `gates.ts`, `classifier.ts`, `normalize-candidate.ts`
3. `strict-intent.ts` + `gemini-extract.ts`
4. `adapters/autograb.ts`
5. `federated-search` edge function
6. Frontend wiring + operator debug page
7. Feature flag + rollout
