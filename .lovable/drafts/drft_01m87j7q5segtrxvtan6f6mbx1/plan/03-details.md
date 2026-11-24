## Finding Macka's Ooglecars user id (and two facts I need)

I can't read Ooglecars from this project. In the **Ooglecars** project, please ask for a read-only lookup of:
1. Macka's Ooglecars user id and email.
2. The table that links a user to a dealership, and confirmation that a signed-in user can read their own row. I'll read it with the user's own token.
3. The dealership ids for Mackay, AJH and The Wholesale Shed.

If (2) isn't readable with the user's token, the fallback is the VPS wholesale `/me` check, which already says whether someone is a dealer or a buyer. I'd need it to also return the dealership id.

## Migration SQL

```sql
CREATE TABLE public.yard_links (
  ooglecars_dealership_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.owner_access (
  ooglecars_user_id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.yard_links, public.owner_access TO service_role;
ALTER TABLE public.yard_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_access ENABLE ROW LEVEL SECURITY;
-- No browser grants or policies: only the gateway reads these.
```

Rows are added as data once I have the ids (no emails in code):
```sql
INSERT INTO public.yard_links VALUES
 ('<MACKAY_DEALERSHIP>','d24da4ea-f500-47fd-9b66-d2c9aa2d3f51'),
 ('<AJH_DEALERSHIP>','8140eae1-2c36-40b6-a358-4f5ed05bbbcf'),
 ('<SHED_DEALERSHIP>','a2aec451-3b68-47f1-aaa8-ce7ef470b30d');
INSERT INTO public.owner_access (ooglecars_user_id, note) VALUES ('<MACKA_ID>','Owner, all yards, 25 Nov');
```

## Files to change
- `supabase/functions/operator-desk/index.ts` (new). Holds the action list, input checks, and the yard filter.
- `supabase/functions/operator-desk/scope.ts` + `scope_test.ts`. Tests: a bad or expired token is refused; dealer A can't read or change dealer B; the owner sees all yards; a buyer is refused; an unknown action is refused.
- `src/pages/operator/deskData.ts` (new). An old admin session uses the current calls; a portal session uses the gateway.
- `src/pages/operator/TradingDeskPage.tsx`. Its data calls switch to `deskData.ts`, and the yard picker only shows the yards the server returns. The layout doesn't change.
- `src/components/trading-desk/TradingDeskHome.tsx` + `homeAccess.ts` + test. A buyer still goes to the buyer desk first; a dealer or the owner goes to the desk.
- `AGENTS.md`. One rule for the gateway's yard boundary.

## Risks
- Opportunities that belong to no yard (no account set) are shown **only to the owner**.
- The desk's charts and market totals use shared public figures, which is fine. But scoring runs across all yards, so for dealers that button stays owner-only.
- Other operator pages aren't covered and stay admin-only.
- Dealers with no `yard_links` row (ACM, Car Boutique) get "no desk yet", not someone else's data.

## Security check and cost
I'll run the security scan after the build: RLS on both new tables, no browser grants, and the gateway refusing requests with no or a wrong token. Rough cost: about 5 to 7 messages, covering the build, adding the rows once I have the ids, a preview check as a dealer and as the owner, and the scan.
