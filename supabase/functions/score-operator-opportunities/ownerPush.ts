// Owner-first push targeting for the scorer's AUTO-NOTIFY step.
// Business rule: scorer finds go to the owner first, never to yard accounts.
// Yards with enabled push subscriptions must never receive scorer pushes.

export const OWNER_PUSH_DEALER_NAMES = ["Mackay Traders"]; // owner's own devices only; scorer never pushes to yard accounts

export interface NotifyRow {
  tier?: string;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  listing_source?: string | null;
  auction_datetime?: string | null;
  best_account_name?: string | null;
}

export interface OwnerPush {
  dealer_name: string;
  title: string;
  body: string;
  url: string;
  force: boolean;
}

const NOTIFY_TIERS = new Set(["CODE_RED", "HIGH", "BUY", "AUCTION_WATCH"]);

/**
 * Build one summary push per owner name from new notify-tier rows.
 * Rows are filtered by tier only — best_account_name never decides who gets
 * pushed; it is only appended to the body for context when present.
 * Every returned push has a non-empty dealer_name (push-send broadcasts to
 * everyone when dealer_name is empty, so that must never happen).
 */
export function buildOwnerPushes(rows: NotifyRow[]): OwnerPush[] {
  const notify = rows.filter((row) => NOTIFY_TIERS.has(String(row?.tier || "")));
  if (notify.length === 0) return [];

  const top = notify[0];
  const vehicle = `${top.year || ""} ${top.make || ""} ${top.model || ""}`.trim();
  const emoji = top.auction_datetime ? "🔨" : "🎯";
  const countText = notify.length > 1 ? ` (+${notify.length - 1} more)` : "";
  const yard = top.best_account_name ? ` → ${top.best_account_name}` : "";

  return OWNER_PUSH_DEALER_NAMES.filter(Boolean).map((dealerName) => ({
    dealer_name: dealerName,
    title: `${emoji} ${notify.length} new match${notify.length > 1 ? "es" : ""}`,
    body: `${top.tier}: ${vehicle}${countText} • ${top.listing_source || ""}${yard}`,
    url: "/operator/trading-desk",
    force: false, // respect quiet hours
  }));
}
