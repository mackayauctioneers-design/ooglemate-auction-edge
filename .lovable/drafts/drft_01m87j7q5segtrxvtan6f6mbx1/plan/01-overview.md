# Ooglecars login opens each yard's own Trading Desk

## Approach: one server-side desk gateway, scoped per yard

A new backend function, `operator-desk`, sits between the Trading Desk and Carbitrage's data for anyone signed in on the portal with Ooglecars:

1. The browser sends the Ooglecars access token with every desk call.
2. **Identity:** the server checks the signature against Ooglecars' published signing keys, plus expiry, issuer and audience. Nothing the browser claims is trusted.
3. **Yard:** the server reads the user's dealership membership from Ooglecars using that same verified token, so Ooglecars' own rules decide what it returns. It then maps the dealership to the Carbitrage yard using a server table, `yard_links` (Mackay, AJH, Shed). The browser never sends a yard.
4. **Owner:** the server checks a second table, `owner_access`, which holds Macka's one row. A match means all yards.
5. Only a fixed list of desk actions is allowed: list opportunities, accounts and buying targets, star, pass, remind, score, and star-watch. Every read and write is filtered to the allowed yard(s) (`account_id` / `best_account_id`) on the server. Writing to a car in another yard returns 403.
6. Pure buyers have no dealership, so they keep going to the buyer desk. Old `/auth` admins keep their current direct path, unchanged.
