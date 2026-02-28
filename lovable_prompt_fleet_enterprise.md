# CarBitrage Fleet Enterprise — Lovable Build Prompt

Paste this entire prompt as a single message in Lovable.

---

## Context

We are building the **CarBitrage Fleet Enterprise** tier — a closed-loop vehicle acquisition intelligence system for large dealership groups. The first target client is Westside Auto Wholesale (Perth, WA) with ~3,000 vehicles.

The existing codebase already has:
- Supabase auth with `app_role` enum (`admin`, `dealer`)
- `OperatorGuard`, `RequireAuth`, `RequireAdmin` guards
- `OperatorSidebar` with sections
- `vehicle_listings` table with enrichment columns
- `fleet_client_users`, `fleet_clients`, `dms_sales_feed`, `fleet_inventory_feed`, `fleet_velocity_metrics`, `fleet_opportunity_scores`, `fleet_buyer_instructions`, `fleet_buyer_activity` tables (from migration `20260301010000_fleet_enterprise.sql` — apply this first)
- Edge functions: `fleet-ingest`, `fleet-velocity-engine`, `fleet-score-opportunities` (already deployed)
- Two new pages already written: `src/pages/fleet/BuyerTerminalPage.tsx` and `src/pages/fleet/FleetDashboardPage.tsx`
- Routes already added to `App.tsx`: `/fleet/buyer-terminal` and `/fleet/dashboard`
- `OperatorSidebar.tsx` already has a **Fleet Enterprise** section at the top with links to both pages

---

## What Lovable needs to do

### 1. Apply the Fleet Enterprise migration

In Supabase SQL Editor, apply `supabase/migrations/20260301010000_fleet_enterprise.sql`. This creates:
- `fleet_clients` — one row per enterprise client
- `fleet_client_users` — maps auth users to fleet clients with roles (buyer, manager, admin)
- `dms_sales_feed` — sold vehicle records from the client's DMS
- `fleet_inventory_feed` — current inventory snapshot
- `fleet_velocity_metrics` — pre-computed analytics per vehicle fingerprint
- `fleet_opportunity_scores` — every market vehicle scored against stock gaps
- `fleet_buyer_instructions` — buying instructions delivered to buyers
- `fleet_buyer_activity` — immutable audit trail of buyer actions
- Adds `fleet` plan to the `plans` table

### 2. Verify the two new pages render correctly

**`/fleet/buyer-terminal`** — The Buyer Terminal
- Full-screen dark UI (black background, white text)
- Header: "Buyer Terminal" with Target icon, critical count badge, refresh button
- Summary strip: Active / Critical / Bids Placed / Won Today
- Tabs: Active | Bids Placed | Completed
- Instruction cards showing:
  - Priority badge (CRITICAL = red, HIGH = amber, NORMAL = grey)
  - NO RESERVE badge (emerald) and DAMAGE badge (orange) when applicable
  - Vehicle: year make model trim, km, source/auction house
  - Live countdown to close time (turns red when <1 hour)
  - Financial strip: Target Buy | Exp. Gross | Days to Sell
  - Score bar (0-100)
  - External link to listing
  - Action buttons: Acknowledge → Log Bid (with amount input) → Won / Lost
  - Pass button
- Realtime updates via Supabase channel subscription

**`/fleet/dashboard`** — Fleet Dashboard (for managers/Head of Used Cars)
- Header: "Fleet Dashboard" with BarChart3 icon, date, Refresh and Run Engine buttons
- Tabs: Overview | Stock Gaps | Team Performance | Aged Stock
- **Overview tab**: 4 KPI cards (Win Rate, Total Won Value, Active Instructions, Avg Bid vs Target) + outcome breakdown bar chart
- **Stock Gaps tab**: Table of top 20 stock gaps ranked by monthly opportunity value — columns: Vehicle, Year Band, Sold/30d, In Stock, Gap (badge), Opp. Value/mo, Avg Gross, Days to Sell
- **Team Performance tab**: Table of buyers — columns: Buyer (avatar + name), Won, Lost, Passed, Win Rate, Total Won Value, Avg Bid vs Target
- **Aged Stock tab**: Table of vehicles on lot 60+ days — columns: Stock #, Vehicle, Year, Days on Lot (badge), Asking Price
- "Run Engine" button invokes `fleet-velocity-engine` then `fleet-score-opportunities` edge functions

### 3. Add a Fleet Client Admin page at `/operator/fleet-clients`

Create `src/pages/operator/FleetClientsPage.tsx`:
- Protected by `OperatorGuard`
- Lists all fleet clients from `fleet_clients` table
- Shows: display_name, slug, state, dms_type, is_active, contact_name, contact_email
- "Add Client" button opens a modal/form to create a new fleet client
- Form fields: Display Name, Slug (auto-generated from name), State, DMS Type (dropdown: pentana/titan/reynolds/csv/api), Contact Name, Contact Email, Contact Phone
- After creation, shows the generated `ingest_api_key` in a copyable code block
- "Manage Users" button per client — opens a panel showing `fleet_client_users` for that client
  - Can add users by email (looks up auth.users by email, creates fleet_client_users record)
  - Can set role (buyer/manager/admin) and speciality_makes (comma-separated input)
  - Can toggle is_active

Add this route to `App.tsx`:
```tsx
<Route path="/operator/fleet-clients" element={<OperatorGuard><FleetClientsPage /></OperatorGuard>} />
```

Add to `OperatorSidebar.tsx` Fleet Enterprise section:
```tsx
{ path: '/operator/fleet-clients', label: 'Fleet Clients', icon: Settings }
```

### 4. Add a DMS Integration Guide page at `/operator/fleet-dms-guide`

Create `src/pages/operator/FleetDMSGuidePage.tsx`:
- Protected by `OperatorGuard`
- Static documentation page explaining how to push data to the fleet-ingest endpoint
- Shows the endpoint URL: `https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/fleet-ingest`
- Authentication: `X-Fleet-API-Key: <client's ingest_api_key>`
- Two sections with code examples:

**Sales Feed** (`?type=sales`):
```json
POST /fleet-ingest?type=sales
X-Fleet-API-Key: <key>

{
  "records": [
    {
      "stock_number": "W12345",
      "vin": "JTMBA3FV1ND123456",
      "make": "TOYOTA",
      "model": "RAV4",
      "year": 2021,
      "trim": "GX",
      "engine_type": "petrol",
      "transmission": "auto",
      "drivetrain": "AWD",
      "odometer": 72000,
      "colour": "White",
      "acquisition_date": "2024-10-15",
      "acquisition_cost": 28500,
      "reconditioning_cost": 850,
      "sale_date": "2024-11-08",
      "sale_price": 34990,
      "source_channel": "auction"
    }
  ]
}
```

**Inventory Feed** (`?type=inventory`):
```json
POST /fleet-ingest?type=inventory
X-Fleet-API-Key: <key>

{
  "records": [
    {
      "stock_number": "W12346",
      "make": "TOYOTA",
      "model": "HiLux",
      "year": 2022,
      "trim": "SR5",
      "odometer": 45000,
      "asking_price": 52990,
      "acquisition_cost": 41000,
      "days_on_lot": 12,
      "status": "available"
    }
  ]
}
```

- Response format section showing success/error responses
- Supported DMS types section: Pentana (CSV export → manual upload), Titan DMS (API push), Reynolds & Reynolds (CSV), Generic CSV, Direct API

Add route to `App.tsx`:
```tsx
<Route path="/operator/fleet-dms-guide" element={<OperatorGuard><FleetDMSGuidePage /></OperatorGuard>} />
```

Add to `OperatorSidebar.tsx` Fleet Enterprise section:
```tsx
{ path: '/operator/fleet-dms-guide', label: 'DMS Integration', icon: Database }
```

### 5. Add a pg_cron schedule for fleet-score-opportunities

Add to the migration (or as a separate SQL statement to run in Supabase SQL Editor):
```sql
-- Run fleet scoring every 30 minutes during business hours (Mon-Fri, 6am-7pm AEST = 20:00-09:00 UTC)
SELECT cron.schedule(
  'fleet-score-opportunities',
  '0,30 20-23,0-9 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/fleet-score-opportunities',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb
  )$$
);

-- Run velocity engine nightly at 2am AEST (16:00 UTC)
SELECT cron.schedule(
  'fleet-velocity-engine-nightly',
  '0 16 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/fleet-velocity-engine',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb
  )$$
);
```

---

## Design system

- Dark theme: `bg-black` base, `text-white`, `border-white/10`
- Cards: `bg-white/[0.03] border-white/10`
- Emerald for positive/buy signals: `text-emerald-400`, `bg-emerald-600`
- Red for critical/urgent: `text-red-400`, `bg-red-500/20`
- Amber for warnings: `text-amber-400`, `bg-amber-500/20`
- Font: existing Tailwind/shadcn setup
- All tables: dark, borderless rows with `hover:bg-white/[0.02]`
- Badges: small, uppercase, letter-spaced

---

## Summary of files to create/modify

| Action | File |
|---|---|
| Create | `src/pages/operator/FleetClientsPage.tsx` |
| Create | `src/pages/operator/FleetDMSGuidePage.tsx` |
| Modify | `src/App.tsx` — add 2 new operator routes |
| Modify | `src/components/layout/OperatorSidebar.tsx` — add Fleet Clients and DMS Integration links |
| Verify renders | `src/pages/fleet/BuyerTerminalPage.tsx` (already written) |
| Verify renders | `src/pages/fleet/FleetDashboardPage.tsx` (already written) |
| Apply in Supabase | `supabase/migrations/20260301010000_fleet_enterprise.sql` |
