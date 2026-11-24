# Macka's Ooglecars login opens the all-yards Trading Desk

## Where this stands
This request (7:00-7:01am) is covered by what is **already built in this draft** under the later per-yard decision (7:07am):

- **Server check:** the backend function `operator-desk` checks the Ooglecars login on the server: signature against Ooglecars' published keys, issuer, audience and expiry. A wrong, expired or missing login gets 401.
- **Owner record:** Macka's access comes from one row in the `owner_access` table (Ooglecars user id `ecaa43a6-8433-4b4e-816e-f2b081e5903d`). Neither that id nor his email is anywhere in the code.
- **Server-side limits:** every Trading Desk read and update goes through that function. It allows only a fixed set of actions and filters every one on the server.
- **Buyers blocked:** buyers with no dealership membership get 403 from the function and keep landing on the buyer desk.
- **Tests and scan:** 30 tests pass. The security scan flagged nothing about the new pieces.

## The one difference
The later decision gives **linked-yard dealers** (Mackay, AJH, Shed members) their own yard's Trading Desk. This request says other Ooglecars users keep **their current desk**.

**Proposed step (only if you want this stricter version):** turn off the per-yard desk for everyone except the owner row:
- In `scope.ts`, a non-owner gets `desk: false`. Every desk action then returns 403 for them.
- The home page then sends dealers and buyers to exactly the pages they reach today.
- Update the tests: dealer A now gets 403 on every desk action, and the owner still sees everything.

If you keep the 7:07am per-yard version, nothing more needs building.
