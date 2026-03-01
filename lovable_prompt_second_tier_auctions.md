# Lovable Prompt — Second-Tier Auction Source Integration

Paste this entire prompt as a single message in Lovable.

---

## Context

CarBitrage currently has deep integration with Pickles (full enrichment pipeline), partial integration with Grays and Manheim, and an outbound search URL bank. We are expanding the platform to cover second-tier, regional, and dealer-only Australian auction houses — specifically sources like F3 Motor Auctions (Newcastle), Central Auto Auctions (Brisbane), City Motor Auction (Brisbane), Central Motor Auctions (Melbourne), Carlins (national dealer-only), Auto Auctions Fairfield, Suttons Auto Auctions, Fowles, Carbids/AllBids, Lloyds Auctions, Slattery Auctions, IAAI Australia, and Turners.

The migration `20260301040000_second_tier_auction_sources.sql` has already been applied and adds ~30 new sources to `dealer_outbound_sources`.

---

## What to build

### 1. Auction Sources Admin Page — `/operator/auction-sources`

Create a new operator page at `/operator/auction-sources` that displays and manages all entries in `dealer_outbound_sources`.

**Layout:**
- Page title: "Auction Sources" with a subtitle "All auction houses and dealer sites monitored by CarBitrage"
- Summary strip at top: Total Sources · Active · Auction Houses · Dealer Sites · States Covered
- Filter bar: filter by `state` (dropdown), `category` (auction / dealer / classifieds), `adapter_type` (pickles / grays / manheim / generic_scrape), and `is_active` toggle
- Table view with columns: Name · State · Category · Adapter · Status (active/inactive toggle) · Notes · Last Seen · Actions
- Each row has an "Edit" button (inline edit for notes and is_active) and a "Test Scrape" button that fires a one-off Manus search for that source URL and shows the result in a modal
- "Add Source" button opens a slide-over form to add a new source manually

**Data:** Read from `dealer_outbound_sources` table. Use Supabase client with service role for updates.

**TypeScript interface:**
```typescript
interface AuctionSource {
  id: string;
  name: string;
  url: string;
  state: string | null;
  category: 'auction' | 'dealer' | 'classifieds' | 'wholesale';
  adapter_type: 'pickles' | 'grays' | 'manheim' | 'generic_scrape' | 'api';
  is_active: boolean;
  notes: string | null;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

### 2. Add "Auction Sources" to the Operator Sidebar

In `src/components/layout/OperatorSidebar.tsx`, add a new item to the **Pipeline** section:

```
{ label: 'Auction Sources', path: '/operator/auction-sources', icon: Building2 }
```

Place it after the existing "Pipeline" item and before "Sources" (if it exists).

---

### 3. Add the route to App.tsx

Import `AuctionSourcesPage` and add the route:
```tsx
<Route path="/operator/auction-sources" element={<OperatorGuard><AuctionSourcesPage /></OperatorGuard>} />
```

---

### 4. Update the `trigger-manus-search` edge function

The `trigger-manus-search` function currently uses a hardcoded list of dealer URLs. Update it to:

1. Query `dealer_outbound_sources` where `is_active = true` and `category IN ('auction', 'dealer')` at the start of each search
2. Build the site search list dynamically from the database results
3. Prioritise sources by: (a) `adapter_type` — pickles/grays/manheim first, then generic_scrape; (b) `state` matching the search vehicle's state if known
4. Cap at 20 sources per search to avoid overwhelming the Manus task

This means adding a new auction house to the database immediately makes it available to OogleBot searches — no code changes required.

---

### 5. Auction Source Coverage Widget on Pipeline Dashboard

On the existing `/operator/pipeline` page, add a small "Source Coverage" widget in the health tab that shows:
- Total active sources
- Breakdown by state (bar chart or simple count list)
- Last 7 days: how many unique sources appeared in search results (from `vehicle_listings.source` column)
- Sources with no activity in 7 days (potential dead links)

Use a simple card layout, no need for a full chart library — a styled list is fine.

---

## Files to create/modify

| File | Action |
|---|---|
| `src/pages/operator/AuctionSourcesPage.tsx` | Create |
| `src/components/layout/OperatorSidebar.tsx` | Edit — add Auction Sources nav item |
| `src/App.tsx` | Edit — add route |
| `supabase/functions/trigger-manus-search/index.ts` | Edit — dynamic source list from DB |
| `src/pages/operator/PipelinePage.tsx` | Edit — add Source Coverage widget to health tab |

---

## Design notes

- Follow the existing operator page design patterns (dark card backgrounds, muted text, badge variants)
- The AuctionSourcesPage should feel like a professional admin tool — clean table, good filtering, clear status indicators
- Active sources get a green dot indicator; inactive get a grey dot
- The `adapter_type` column should show coloured badges: pickles (orange), grays (blue), manheim (purple), generic_scrape (slate)
- The "Test Scrape" modal should show a loading spinner while the Manus task runs, then display the top 3 results found

---

## No new database migrations needed

The migration `20260301040000_second_tier_auction_sources.sql` has already been applied. All new sources are already in `dealer_outbound_sources`.
