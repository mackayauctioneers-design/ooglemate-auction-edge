## Proposed change (no new code, data only)

1. **Macka signs in once at Carbitrage `/auth`** with the email he normally uses. That creates his Carbitrage user through the normal sign-up. No password is set by us and nothing is bypassed.
2. I read his new user id (read-only), then record one migration that grants the same role the old admin has:

```sql
-- Grant Macka the existing operator role (same as daveooglemate@gmail.com)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = lower('<MACKA_EMAIL>')
ON CONFLICT (user_id, role) DO NOTHING;
```

The email only appears in this one data insert. It is not added to the app code or used as an allow-list.

3. **Routing check (already in place, unchanged):** at `/`, a Carbitrage session with `admin` opens the Trading Desk for all yards. The buyer desk stays reachable directly at `/portal/buyer-prices` with his portal sign-in. I'll confirm both in the preview after the grant.

**Caveat:** if his portal (buyer) session is active in the same browser, `/` still sends him to the buyer view, by design. He'd use the Trading Desk link or the operator sidebar, or sign out of the portal. Making his *portal* account itself open the desk would mean trusting an Ooglecars role inside Carbitrage. That's a bigger cross-service change, and I'd plan it separately if you want it.

## Nothing changes for anyone else
- One row added for one user. No other role rows, rules or code change.
- Other dealers and buyers keep their current landing pages.

## Security notes
- An `admin` role gives full operator access to every yard, the same as the old admin account. That's intended here.
- The existing `get_user_role` returns one role at random (`LIMIT 1`) if a user has several. Macka would only have `admin`, so it doesn't affect him. Worth tidying later.
- Two stale admin accounts (fahad.oarans@, jezreeljoshadlaon@, last signed in February) still have full access. I recommend reviewing them, but I won't touch them in this change.

## Needed from you
Macka's sign-in email. He then needs to sign up once at `/auth`.
