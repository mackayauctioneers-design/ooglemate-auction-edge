# Macka's portal login opens the Trading Desk (server-verified)

## Approach: a server-side operator gateway

The Trading Desk makes about 8 kinds of data calls: read opportunities, accounts and buying targets, star/pass/reminder updates, and run scoring and star-watch. A new backend function, `operator-desk`, handles these for portal sign-ins:

1. Macka signs in on the portal as usual, using his Ooglecars login.
2. For each desk call, the browser sends his portal access token to `operator-desk`.
3. The function checks the token **on the server** every time. It verifies the signature against Ooglecars' published signing keys and checks expiry, issuer and audience. If the keys can't be fetched, it calls Ooglecars' own `/auth/v1/user` check instead. Nothing the browser says is trusted.
4. It looks up the verified Ooglecars user id in a new table, `operator_identity_links`. Without an active row, it refuses (403).
5. With a row, it runs only a fixed list of named actions, with every input checked. No raw queries. The same rules the old admin has apply.
6. Old `/auth` admins keep their current direct path, unchanged. No Carbitrage session is created for Macka, and his access is checked on every call, so switching off his link row takes effect at once.
