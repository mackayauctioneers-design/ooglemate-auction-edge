## Answers
- **Who gets mapped:** only Macka, Ooglecars user id `ecaa43a6-8433-4b4e-816e-f2b081e5903d`. His email isn't needed and isn't stored.
- **Migration:** already applied in this draft; no new one is needed. It adds `yard_links` and `owner_access`, both with row security on and no browser access.
- **Files for the stricter option:** `supabase/functions/operator-desk/scope.ts`, `server/carbitrage/operator-desk-scope.test.ts` and `server/carbitrage/trading-desk-home.test.ts`. The per-yard home routing then never fires for non-owners.
- **Rough cost:** about 1-2 messages for the stricter option (edit, run the tests, scan again). The per-yard version as built costs nothing more.

## Risks
- If Macka is signed into a buyer account and the portal in the same browser, the verified owner check wins and he lands on the Trading Desk. Others are unaffected.
- His desk's charts and valuation box load their data the old way and are refused, so they show empty. Scoring and sending to a dealer stay operator-only for now.
- The live check as Macka still needs his real sign-in in the preview.
- Accepting the draft brings the two new tables across. Macka's owner row (and the yard links) must be added separately in the app's data.
