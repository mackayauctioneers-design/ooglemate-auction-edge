# Roadmap

## Live dealer desk
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
