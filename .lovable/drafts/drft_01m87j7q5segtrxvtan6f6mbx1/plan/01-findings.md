# Macka opens the Trading Desk via the existing role system

## What the live read found (read-only)

**Operator accounts on the Carbitrage sign-in (the old /auth):** every one has role `admin` in `user_roles`. There is no separate `operator` role. The desk opens for `admin` or `internal`.

| email | user id | last sign-in | role |
|---|---|---|---|
| daveooglemate@gmail.com | c11b7ec5-38dc-4999-9351-6c3d4a4dff31 | 2026-09-10 | admin |
| fahad.oarans@gmail.com | 42bfdb23-efec-4bfd-a41e-a070e8f3c457 | 2026-02-18 | admin |
| jezreeljoshadlaon@gmail.com | 86edd177-072e-45be-a3d4-ccb5e6ab29f3 | 2026-02-17 | admin |

**Macka's buyer-desk account is not in this database.** No Carbitrage user matches "macka"/"mackay" by email or profile name. The /portal sign-in uses the **Ooglecars** sign-in service (`esyinwxhcpexncgqcnwi`), not Carbitrage's (`xznchxsbuwngfmwvsvhq`). I can't read that service from here, so I don't have Macka's portal email, user id or last sign-in.

**Why he lands on the buyer desk:** the home page (`/`) only opens the Trading Desk when the Carbitrage sign-in returns `admin`/`internal`. And a portal session that the wholesale service marks as **buyer** always goes to the buyer view first, on purpose. That stops a buyer session from borrowing operator access in the same browser.

So just adding a role row can't help on its own. The role check only runs against Carbitrage sign-ins, and Macka's account doesn't exist there.
