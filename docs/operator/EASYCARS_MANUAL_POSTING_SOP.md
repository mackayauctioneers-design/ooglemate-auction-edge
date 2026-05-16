# EasyCars Manual Posting — Operator SOP

**Page:** `/operator/easycars-posting`
**Who:** Admin / Internal operators only (`OperatorGuard`)
**Why it exists:** EasyCars write automation is parked (OpenClaw blocked, no API/import).
This is the fallback that lets the pipeline keep moving while we log every action for audit.

> Manual status here is **operator-recorded, not automated**. Never use this to pretend
> automation succeeded.

---

## States

| Status | Meaning |
|---|---|
| `pending` | Trade has been ingested but not yet triaged for EasyCars. |
| `manual_ready` | Operator has confirmed it should be posted to EasyCars; awaiting human posting. |
| `manual_posted` | Operator has posted it in EasyCars (browser/manual) and recorded the stock #. |

---

## 1) Mark ready

When a trade should be posted to EasyCars next:

1. Open `/operator/easycars-posting` → **Pending** tab.
2. Find the trade (use search: rego, VIN, stock #, supplier, invoice).
3. Click **Mark ready**.

This records `easycars_ready_at` + `easycars_ready_by` (you).

> Tip: bulk select rows and use **Bulk mark ready** when you've triaged a batch.

---

## 2) Post manually in EasyCars

1. Switch to the **Ready** tab.
2. Find the row. Use the **copy buttons** to grab rego / VIN / supplier / acquisition cost / invoice #, or click **Payload** to copy a full JSON snapshot.
3. Switch to EasyCars, create the stock entry, paste fields.
4. Back in the queue, paste the **EasyCars stock #** in the input.
5. (Optional) Add a short **note** if anything was non-standard.
6. Click **Mark posted**.

This records `easycars_posted_at`, `easycars_posted_by`, the manual stock #, and the note.

---

## 3) Revert

If you marked a row by mistake or EasyCars rejected the post:

- Click **Revert** → returns the trade to `pending` and clears the ready/posted audit fields.

Use revert sparingly — it's logged but it blanks the manual stock/note.

---

## 4) Backlog hygiene

Rows that have been **Ready > 1 day** are highlighted **amber**.
Rows **Ready > 3 days** are highlighted **red** — clear these first.

Slack alerts fire automatically:

- **Hourly** — only if there is a stale `manual_ready` backlog (>1d).
- **Daily 08:00 AET** — digest with pending / ready / oldest age / posted-today counts.

Both link directly back to the queue.

---

## 5) Where to start each day

1. Open `/operator/ops` → **EasyCars Manual Posting** card.
   - If `Ready > 1 day` count is red, that's today's first job.
2. Click into the card → queue opens on the **Ready** tab.
3. Work the red rows, then amber, then the rest of Ready.
4. Triage Pending → Ready when you have spare cycles.

---

## 6) Export / handoff

Use **CSV** (top right, or the bulk-bar Export selected) to hand a batch to someone else without giving them operator access. CSV includes trade id, timestamps, rego, VIN, supplier, invoice, cost, stock #, and note.

---

## Guardrails (do not violate)

- Manual and automated posting must stay clearly separate. Do not script
  `manual_posted` writes from anything other than this operator UI.
- `OperatorGuard` covers the page and admin-only RLS covers the table — keep both.
- Never claim automation succeeded. If EasyCars wasn't actually updated, don't mark posted.

---

## When automation comes back

When EasyCars write access is unblocked (API docs / import / reachable bridge),
this queue becomes the **review surface** for automated posts. The statuses
will gain `auto_posted` / `auto_failed`; manual statuses stay untouched so the
audit trail remains intact.
