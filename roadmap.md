# Roadmap

## Live dealer desk
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
