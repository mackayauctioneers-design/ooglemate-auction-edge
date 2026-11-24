## Who gets mapped

I can't read the Ooglecars sign-in service from this project, so I don't have Macka's Ooglecars user id or email. I need **one** of these:
- His Ooglecars user id and email, sent from the Ooglecars project (a read-only lookup there), or
- Your approval for the gateway to log his verified id once, the first time he opens `/` (it's refused that time). I then add the row from that log.

## Migration SQL

```sql
CREATE TABLE public.operator_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ooglecars_user_id uuid NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.operator_identity_links TO service_role;
ALTER TABLE public.operator_identity_links ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants or policies: only the gateway can read it.
```

Macka's one row is added as data, not code:
```sql
INSERT INTO public.operator_identity_links (ooglecars_user_id, note)
VALUES ('<OOGLECARS_ID>', 'Macka, approved 25 Nov');
```

## Files to change
- `supabase/functions/operator-desk/index.ts` (new). The fixed action list, input checks, and 401/403 on any failure.
- `supabase/functions/operator-desk/verify.ts` + `verify_test.ts`. Tests cover: bad signature, expired token, wrong issuer, unlinked id, inactive link, an unknown action, and a linked id that's allowed through.
- `src/pages/operator/deskData.ts` (new). A small switch: an old admin session uses the current direct calls, and a portal session uses `operator-desk`.
- `src/pages/operator/TradingDeskPage.tsx`. Point its existing data calls at `deskData.ts`. The layout doesn't change.
- `src/components/trading-desk/TradingDeskHome.tsx` + `homeAccess.ts` + test. If there's a portal session, ask `operator-desk` "am I an operator?" The **buyer-first rule stays**: buyer → buyer view, verified operator → desk, otherwise unchanged.
- `AGENTS.md`. One rule for the gateway boundary.

## Buyer-only users
They have no link row, so every gateway call returns 403. Their landing pages are unchanged, and operator tables stay closed to them as before. A test asserts this.

## Security check
I'll run the security scan after the build. It should confirm the new table has RLS on and no client grants, and that the gateway rejects requests without a token.

## Risks
- **Scope:** only the desk's current actions go through. Other operator pages (sidebar extras) stay admin-only for now.
- **Linking the wrong id gives all-yard access.** That's why the row is added only from a confirmed id.
- **Ooglecars key changes:** verification follows their published keys automatically.

## Rough credit cost
About 4 to 6 messages: build plus deploy, adding his row once I have the id, then a preview check and the security scan.
