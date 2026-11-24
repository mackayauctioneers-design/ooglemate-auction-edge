# Roadmap

## Ooglecars → Carbitrage connection
- [x] Check sender code and receiving sales aggregates; confirmed 477 Ooglecars-feed sales across three accounts, received today, and recorded the distinct product responsibilities.
- [x] Check downstream freshness and schedules; saved buying patterns are stale/missing, target runs last recorded 21 November, and the older 15-minute mandate schedule is disabled. Audit: `.lovable/reviews/ooglecars-carbitrage-link.md`.
- [x] Review the supplied 24 November VPS report: sales push succeeds, current winner cells remain VPS-only, three legacy jobs read June data, and finder results remain chat-only; running VPS status is reported, not independently verified.
- [x] Inspect the supplied winner-cell sample and live profile/unique-key records: Mackay and AJH resolve, Shed has no profile; the recent Hilux mean is below the existing mandate profit gate. Record field semantics without changing prices or qualification.
- [x] Confirm VPS identity is dealer + level + cell_key, with exact km split inside cell_key; use account + level + cell_key for the site's namespaced unique fingerprint ID, never a separate km-band component.
- [x] Add and deploy only the existing sales-ingest fingerprints action; 32 adapter tests pass, live GET/no-token/wrong-token requests return 405/401/401, build OK, original sales path verified unchanged. Provide the VPS export contract; no new schedules, pricing logic, screens, migrations or secrets.
- [x] VPS live verification passed 24 Nov: 707-row resend all skipped in 30s, one-figure change updated the same record, deactivate worked first go; write-back now runs automatically after every profile refresh and marks dropped cells inactive. Site totals match VPS exactly: Mackay 707, AJH 252, all inactive with alerts off, no private fields. Verified against the live database.
- [x] Created dealer profile for The Wholesale Shed (profile 7132b81b-74f3-48d7-af65-4ee0776b7226, account a2aec451-3b68-47f1-aaa8-ce7ef470b30d); location set to Port Macquarie NSW 2444. Its 115 held patterns can now import on the next VPS refresh. New imported patterns require existing site approval before buying-target activation; dealer-result delivery remains separate.

## Trading Desk fix-only pass
- [x] Correct canonical ticker consistency, wrap all ten mobile counters, reuse the shared guide with rego/state/km or details/km and clear failures, hide empty charts and remove duplicate scanning status. Verified 70 tests, build OK, signed-in operator root, controlled guide results/errors, buyer isolation and 320/390/768px counters; unpublished. Real guide call failed in this draft and now displays an error rather than substituted figures; live guide success remains unverified.

## Trading Desk home tune-up
- [x] Restore the owner/operator root desk using existing verified roles; preserve wholesale-buyer destinations and signed-out sign-in.
- [x] Tidy counters, add public live ticker, reuse OogleVal, and show charts only from loaded finds; tighten opportunity rows without pricing changes. Existing opportunity feed lacks floor gaps and scan timestamps, so these remain unavailable rather than fabricated.
- [x] Verify 69 tests, real draft operator root access, controlled buyer/valuation flows, and desktop/mobile preview; keep unpublished. Hosted owner sign-in and live guide access remain unverified; sign-in screens and destinations outside root are unchanged as requested.

## Live dealer desk
- [x] Add summary counters and 60-second Worker activity feed without changing existing panels; 51 tests and signed-in controlled polling, links, Sydney times and mobile placement verified; unpublished.
- [ ] Confirm /summary and /activity live field names (waiting on redacted server responses; unauthenticated endpoints return 401).
- [x] Add compact OogleVal using the existing guide call and polling, server-only figures and up to three shape queue cards; verified controlled signed-in flow and mobile; unpublished. Hosted VPS dealer access remains unverified.
- [x] Add approved New car pre-fill from desk links only; verified fields, unchecked odometer and mandatory guide flow.
- [x] Add read-only stock and closing-auction panels; verified 21 tests, signed-in controlled responses, drawer links, sorting, staff blanks and mobile layout; unpublished.
- [x] Align /stock and /auctions with confirmed response fields, server groups, cost gaps and nullable stock numbers; keep unpublished.
- [x] Add read-only queue and DNA panels at /portal/desk; tested preview examples, filters, privacy rules and signed-in staff display with controlled responses.
- [ ] Confirm live response field mapping with a redacted /queue and /dna response (waiting on API contract).

## Public Live market page
- [x] Add /listings, live statistics hook and main navigation link; verify live data, mobile layout and failure state.

## Agent Conduit (done, one item open)
- [x] Tables: agent_registry, agent_watch_links, agent_heartbeats (RLS + grants)
- [x] agent-checkin edge function (deployed)
- [x] Operator page /operator/agents + dashboard link
- [x] Dealer-facing "Watching for you" card on dealer home
- [ ] AGENT_CHECKIN_KEY: user must set a value they can also give to their agents (secure form)

## Self-host copy of the site on VPS
- [ ] Explain build/export path: repo → static build → VPS serve; backend stays Lovable Cloud unless migrated

## Dealer Studio integration (parked)
- Dealership ID 3103, slug `oogle-cars-sandpit`, location ID 10799
- [ ] Need API token pasted into a secure form (safe link not accessible to me)
- [ ] Decide what the integration does (inventory feed? leads? sales?)

## 120-day own-sale price window (Macka rule, 24 Nov 2026)
- [x] domain.ts: OWN_SALE_PRICE_WINDOW_DAYS/MS (120), SIX_MONTHS_MS deprecated alias, isRecentSale + floorSource wording
- [x] services.ts: aggregateOlder returns count only, medianPrice always null
- [x] Wording: mcp.ts get_insights, DnaPage, FindDetailPage, InsightsPage
- [x] isolation.test.ts renamed, medianPrice null expectation; all isolation tests pass (rls.integration fails on missing sudo in sandbox — environmental)

## Per-yard Trading Desk via Ooglecars login (approved 25 Nov)
- [x] Tables, operator-desk gateway, desk wiring, tests, scan
- [ ] Live sign-in check as Macka and as a single-yard dealer (needs real Ooglecars logins)
