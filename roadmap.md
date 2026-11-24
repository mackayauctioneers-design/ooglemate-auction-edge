# Roadmap

## Ooglecars → Carbitrage connection
- [x] Check sender code and receiving sales aggregates; confirmed 477 Ooglecars-feed sales across three accounts, received today, and recorded the distinct product responsibilities.
- [x] Check downstream freshness and schedules; saved buying patterns are stale/missing, target runs last recorded 21 November, and the older 15-minute mandate schedule is disabled. Audit: `.lovable/reviews/ooglecars-carbitrage-link.md`.
- [x] Review the supplied 24 November VPS report: sales push succeeds, current winner cells remain VPS-only, three legacy jobs read June data, and finder results remain chat-only; running VPS status is reported, not independently verified.
- [x] Inspect the supplied winner-cell sample and live profile/unique-key records: Mackay and AJH resolve, Shed has no profile; the recent Hilux mean is below the existing mandate profit gate. Record field semantics without changing prices or qualification.
- [ ] Finalise fingerprint write-back identity before changing sales-ingest (waiting on VPS confirmation of dealer + level + cell key + km-band uniqueness; Shed also needs an explicitly provisioned site profile before importing its patterns). Keep the old 15-minute schedule off and dealer-result delivery separate.

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
