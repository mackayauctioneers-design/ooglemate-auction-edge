export interface DeskFind {
  created_at: string;
  listing_source: string | null;
  tier: string;
  status: string;
  is_starred: boolean;
}

export function marketTickerFigures(data: { total_live_listings?: number; retail_dealer_listings?: number; auction_lots_open?: number; added_last_24h?: number; wholesale_price_points?: { total?: number } }) {
  // Never repair server totals with browser arithmetic; omit an inconsistent breakdown.
  const consistent = typeof data.retail_dealer_listings === 'number' && typeof data.auction_lots_open === 'number' && data.retail_dealer_listings + data.auction_lots_open === data.total_live_listings;
  const figures = [
    { label: 'Live listings', value: data.total_live_listings },
    { label: 'New 24h', value: data.added_last_24h },
    ...(consistent ? [{ label: 'Dealer ads', value: data.retail_dealer_listings }, { label: 'Open auction lots', value: data.auction_lots_open }] : []),
    { label: 'Wholesale price points', value: data.wholesale_price_points?.total },
  ];
  return figures.flatMap(figure => typeof figure.value === 'number' && Number.isFinite(figure.value) && figure.value >= 0 ? [{ label: figure.label, value: figure.value }] : []);
}

export function latestScanTime(rows: { last_scan_at?: string | null; created_at?: string }[]): string | null {
  const times = rows.flatMap(row => row.last_scan_at && Number.isFinite(Date.parse(row.last_scan_at)) ? [row.last_scan_at] : []);
  return times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export function sydneyFoundTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function sourceName(source: string | null) {
  if (!source) return 'Unknown source';
  const names: Record<string, string> = { carsales: 'Carsales', dealer_sites: 'Dealer sites', dealer_website: 'Dealer sites', pickles: 'Pickles', grays: 'Grays', slattery: 'Slattery', manheim: 'Manheim', autotrader: 'Autotrader', gumtree: 'Gumtree' };
  return names[source.toLowerCase()] ?? source.replace(/_/g, ' ');
}

/** Presentation groups returned tiers only; it never re-scores a car. */
export function decisionTier(tier: string): 'BUY' | 'WATCH' | 'PASS' | null {
  if (['CODE_RED', 'HIGH', 'BUY', 'RETAIL_BUY'].includes(tier)) return 'BUY';
  if (['WATCH', 'AUCTION_WATCH', 'RETAIL_TARGET'].includes(tier)) return 'WATCH';
  if (tier === 'PASS') return 'PASS';
  return null;
}

const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function findsByDay(rows: DeskFind[], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now.getTime() - (6 - i) * 86400000);
    return { key: dayKey(date), day: new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' }).format(date), count: 0 };
  });
  for (const row of rows) {
    if (!Number.isFinite(Date.parse(row.created_at))) continue;
    const day = days.find(d => d.key === dayKey(new Date(row.created_at)));
    if (day) day.count += 1;
  }
  return days.some(d => d.count > 0) ? days : [];
}

export function findsBySource(rows: DeskFind[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.listing_source) continue;
    const name = sourceName(row.listing_source);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}

export function counterTrend(rows: DeskFind[], tier: string, now = new Date()) {
  const actionable = new Set(['new', 'assigned', 'reviewed']);
  const matched = rows.filter(row => actionable.has(row.status) && (tier === 'NEW_24H' || (tier === 'starred' ? row.is_starred : row.tier === tier)));
  const today = matched.filter(row => now.getTime() - Date.parse(row.created_at) >= 0 && now.getTime() - Date.parse(row.created_at) < 86400000).length;
  const yesterday = matched.filter(row => now.getTime() - Date.parse(row.created_at) >= 86400000 && now.getTime() - Date.parse(row.created_at) < 172800000).length;
  return today + yesterday === 0 ? null : today > yesterday ? 'up' : today < yesterday ? 'down' : 'steady';
}

/** Missing floor gaps stay missing. Under-buy and retail-median gaps are different anchors. */
export function returnedFloorGap(row: { floor_gap?: number | null; floor_gap_pct?: number | null }) {
  return { dollars: row.floor_gap ?? null, percent: row.floor_gap_pct ?? null };
}