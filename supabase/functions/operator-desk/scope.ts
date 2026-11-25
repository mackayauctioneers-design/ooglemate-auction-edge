// operator-desk core: verified Ooglecars identity -> yard scope -> allow-listed Trading Desk actions.
// Pure module (no Deno/npm imports) so the same code runs in the edge function and in node tests.
// The browser never sends a yard: scope comes only from verified dealership membership (role = owner) + yard_links,
// or the owner_access record (all yards). Cross-yard actions are owner_access-only.

import { blankStaleAnchor, expiryReason, needsManheimEnd, withManheimEnd, type CoverageSale, type SaleListing } from "../_shared/deskFreshness.ts";

export const ACTIONABLE_STATUSES = ["new", "assigned", "reviewed"] as const;
const STATUSES = new Set(["new", "assigned", "reviewed", "purchased", "passed", "expired", "lost", "watching"]);
const FIND_STATUSES = new Set(["active", "starred", "dismissed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Claims = { sub?: unknown; exp?: unknown; iss?: unknown; aud?: unknown };
/** jose-compatible verifier: must check signature, issuer, audience and expiry, and throw on any failure. */
export type VerifyJwt = (token: string) => Promise<{ payload: Claims }>;
export type Membership = { dealership_id: string; role?: string | null };
export type Opp = Record<string, unknown> & { id: string; best_account_id?: string | null; assigned_to_account?: string | null; alt_matches?: unknown };
export type Mandate = Record<string, unknown>;

export interface DeskStore {
  isOwner(ooglecarsUserId: string): Promise<boolean>;
  yardAccounts(dealershipIds: string[]): Promise<string[]>;
  accounts(ids: string[] | null): Promise<{ id: string; display_name: string }[]>;
  listOpps(q: { accountIds: string[] | null; focus: string | null; freshFloor: string; activeLimit: number; starredLimit: number }): Promise<{ active: Opp[]; starred: Opp[] }>;
  getOpp(id: string): Promise<Opp | null>;
  updateOpp(id: string, patch: Record<string, unknown>): Promise<void>;
  hasStarHunt(q: { make: string; model: string; accountId: string | null }): Promise<boolean>;
  insertMandate(row: Mandate): Promise<void>;
  listFinds(): Promise<unknown[]>;
  updateFind(id: string, patch: Record<string, unknown>): Promise<boolean>;
  /** Source listing state by listing_id, used to hide finds whose auction ended or listing is gone. */
  listingStates?(listingIds: string[]): Promise<Record<string, SaleListing>>;
  /** sales[] of the latest manheim source_coverage row (Manheim lots have no per-lot end). */
  manheimSales?(): Promise<CoverageSale[]>;
  /** Owner-only finder catches, newest first. */
  listCatches?(q: { offset: number; limit: number; source: string | null; status: string | null }): Promise<{ rows: unknown[]; total: number }>;
  /** Owner-only source coverage rows for the most recent days. */
  listCoverage?(): Promise<unknown[]>;
  /** Fresh Carsales "well below market" listings (owner-only). */
  listWbm?(): Promise<unknown[]>;
  /** Calls an existing backend function with the server client. Name is fixed by the action, never by the caller. */
  invoke(fn: "score-operator-opportunities" | "star-watch-dispatch" | "push-send" | "market-scanner", body: Record<string, unknown>): Promise<unknown>;
}
export type Deps = { verify: VerifyJwt; memberships: (token: string, sub: string) => Promise<Membership[]>; store: DeskStore; now?: () => Date };

export class DeskError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

/** accountIds null = owner_access (all yards, including unassigned cars). ownedYards = owner memberships seen (linked or not). */
export type Scope = { userId: string; owner: boolean; accountIds: string[] | null; ownedYards: number };

export async function resolveScope(token: string, deps: Deps): Promise<Scope> {
  if (!token || token.split(".").length !== 3) throw new DeskError(401, "unauthorized");
  let claims: Claims;
  try { claims = (await deps.verify(token)).payload; } catch { throw new DeskError(401, "unauthorized"); }
  const sub = claims.sub;
  const exp = claims.exp;
  const nowSec = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  if (typeof sub !== "string" || !UUID.test(sub) || typeof exp !== "number" || exp <= nowSec) throw new DeskError(401, "unauthorized");
  if (await deps.store.isOwner(sub)) return { userId: sub, owner: true, accountIds: null, ownedYards: 0 };
  const rows = await deps.memberships(token, sub);
  // Only yard owners get a desk; admin/staff/other roles are treated exactly like buyers.
  const dealershipIds = [...new Set(rows.filter((r) => r?.role === "owner").map((r) => r.dealership_id).filter((d): d is string => typeof d === "string" && d.length > 0))];
  const accountIds = dealershipIds.length ? [...new Set(await deps.store.yardAccounts(dealershipIds))] : [];
  return { userId: sub, owner: false, accountIds, ownedYards: dealershipIds.length };
}

const yardsOf = (scope: Scope) => new Set(scope.accountIds ?? []);

/** Read rule: best-matched to or assigned to one of the caller's yards. */
export function inScope(scope: Scope, opp: Opp): boolean {
  if (scope.accountIds === null) return true;
  const yards = yardsOf(scope);
  return (!!opp.best_account_id && yards.has(opp.best_account_id)) || (!!opp.assigned_to_account && yards.has(opp.assigned_to_account));
}

/** Write rule: the car's current assignment is theirs, or it is unassigned and best-matched to theirs. */
export function canWrite(scope: Scope, opp: Opp): boolean {
  if (scope.accountIds === null) return true;
  const yards = yardsOf(scope);
  if (opp.assigned_to_account) return yards.has(opp.assigned_to_account);
  return !!opp.best_account_id && yards.has(opp.best_account_id);
}

/** Dealers never see other yards' alternative matches. */
export function redact(scope: Scope, opp: Opp): Opp {
  if (scope.accountIds === null) return opp;
  const yards = yardsOf(scope);
  const alt = Array.isArray(opp.alt_matches) ? opp.alt_matches.filter((m: any) => m && yards.has(m.account_id)) : opp.alt_matches;
  return { ...opp, alt_matches: alt };
}

const PATCH_KEYS = new Set(["status", "is_starred", "reminder_at", "assigned_to_account"]);

function parsePatch(scope: Scope, raw: unknown, accounts: { id: string; display_name: string }[], now: Date): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DeskError(400, "invalid patch");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length) throw new DeskError(400, "invalid patch");
  const patch: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (!PATCH_KEYS.has(k)) throw new DeskError(400, `field not allowed: ${k}`);
    if (k === "status") { if (typeof v !== "string" || !STATUSES.has(v)) throw new DeskError(400, "invalid status"); patch.status = v; }
    if (k === "is_starred") { if (typeof v !== "boolean") throw new DeskError(400, "invalid is_starred"); patch.is_starred = v; }
    if (k === "reminder_at") { if (v !== null && (typeof v !== "string" || Number.isNaN(Date.parse(v)))) throw new DeskError(400, "invalid reminder_at"); patch.reminder_at = v; }
    if (k === "assigned_to_account") {
      if (typeof v !== "string" || !UUID.test(v)) throw new DeskError(400, "invalid account");
      if (scope.accountIds !== null && !scope.accountIds.includes(v)) throw new DeskError(403, "forbidden");
      const acct = accounts.find((a) => a.id === v);
      if (!acct) throw new DeskError(400, "invalid account");
      patch.assigned_to_account = v; patch.assigned_to_name = acct.display_name; patch.assigned_at = now.toISOString();
    }
  }
  patch.updated_at = now.toISOString();
  return patch;
}

const needUuid = (v: unknown, what = "id"): string => { if (typeof v !== "string" || !UUID.test(v)) throw new DeskError(400, `invalid ${what}`); return v; };
const ownerOnly = (scope: Scope) => { if (!scope.owner) throw new DeskError(403, "forbidden"); };

async function writableOpp(scope: Scope, id: unknown, deps: Deps): Promise<Opp> {
  const opp = await deps.store.getOpp(needUuid(id));
  if (!opp || !canWrite(scope, opp)) throw new DeskError(403, "forbidden");
  return opp;
}

/** The yard a watch/hunt is filed under: always the car's own yard, never one the browser names. */
const carYard = (opp: Opp): string | null => (opp.assigned_to_account || opp.best_account_id || null) as string | null;

export async function handleDesk(token: string, body: unknown, deps: Deps): Promise<unknown> {
  const scope = await resolveScope(token, deps);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = b.action;
  const now = deps.now?.() ?? new Date();
  const desk = scope.owner || (scope.accountIds?.length ?? 0) > 0;
  if (action === "whoami") {
    const accounts = desk ? await deps.store.accounts(scope.accountIds) : [];
    return { owner: scope.owner, desk, has_membership: scope.ownedYards > 0, accounts };
  }
  if (!desk) throw new DeskError(403, "forbidden");

  switch (action) {
    case "list": {
      let focus: string | null = null;
      if (b.account_id !== undefined && b.account_id !== null && b.account_id !== "all") {
        focus = needUuid(b.account_id, "account");
        if (scope.accountIds !== null && !scope.accountIds.includes(focus)) throw new DeskError(403, "forbidden");
      }
      const freshFloor = new Date(now.getTime() - 14 * 86400000).toISOString();
      const scoped = focus !== null || scope.accountIds !== null;
      const { active, starred } = await deps.store.listOpps({ accountIds: scope.accountIds, focus, freshFloor, activeLimit: scoped ? 1000 : 500, starredLimit: scoped ? 500 : 100 });
      const ids = new Set(active.map((o) => o.id));
      const merged = [...active, ...starred.filter((o) => !ids.has(o.id))].filter((o) => inScope(scope, o));
      const lids = [...new Set(merged.map((o) => o.listing_id).filter((x): x is string => typeof x === "string" && !x.startsWith("retail:")))];
      const states = deps.store.listingStates && lids.length ? await deps.store.listingStates(lids) : {};
      const sales = deps.store.manheimSales && merged.some(needsManheimEnd) ? await deps.store.manheimSales() : null;
      // Never show a find whose auction has ended or whose source listing is gone; anchors older than 120 days carry no prices.
      const opportunities = merged
        .map((o) => withManheimEnd(o, states[o.listing_id as string], sales))
        .filter((o) => o.is_starred === true || !expiryReason(o, states[o.listing_id as string], now))
        .map((o) => blankStaleAnchor(redact(scope, o), now));
      return { owner: scope.owner, opportunities, accounts: await deps.store.accounts(scope.accountIds) };
    }
    case "update": {
      const opp = await writableOpp(scope, b.id, deps);
      const patch = parsePatch(scope, b.patch, await deps.store.accounts(scope.accountIds), now);
      await deps.store.updateOpp(opp.id, patch);
      return { ok: true, patch };
    }
    case "watch": {
      // Re-check one starred car; filed under the car's own yard.
      const opp = await writableOpp(scope, b.id, deps);
      if (typeof opp.listing_id !== "string" || !opp.listing_id) throw new DeskError(400, "car has no listing");
      await deps.store.invoke("star-watch-dispatch", { listing_id: opp.listing_id, account_id: carYard(opp) });
      return { ok: true };
    }
    case "hunt": {
      // Hunt for similar cars: built from the stored car (±1 year, ±15,000 km), never from browser fields.
      const opp = await writableOpp(scope, b.id, deps);
      const make = opp.make, model = opp.model, year = opp.year;
      if (typeof make !== "string" || typeof model !== "string" || typeof year !== "number") throw new DeskError(400, "car lacks make/model/year");
      const accountId = carYard(opp);
      if (await deps.store.hasStarHunt({ make, model, accountId })) return { ok: true, created: false };
      const km = typeof opp.km === "number" ? opp.km : null;
      const variant = typeof opp.variant === "string" && opp.variant ? opp.variant : null;
      await deps.store.insertMandate({
        name: `⭐ ${year} ${make} ${model}${variant ? " " + variant : ""}`, make, model, variant_family: variant,
        year_min: year - 1, year_max: year + 1, km_min: km !== null ? Math.max(0, km - 15000) : null, km_max: km !== null ? km + 15000 : null,
        lane: "star_hunt", priority: "high", account_id: accountId, run_frequency_minutes: 240, is_active: true,
      });
      return { ok: true, created: true };
    }
    case "score": {
      ownerOnly(scope);
      const focus = b.focus_account_id === undefined || b.focus_account_id === null ? null : needUuid(b.focus_account_id, "account");
      return { ok: true, result: await deps.store.invoke("score-operator-opportunities", focus ? { focus_account_id: focus } : {}) };
    }
    case "send_to_dealer": {
      ownerOnly(scope);
      const opp = await deps.store.getOpp(needUuid(b.id));
      if (!opp) throw new DeskError(404, "not found");
      const dealer = (opp.assigned_to_name || opp.best_account_name) as string | null;
      if (!dealer) throw new DeskError(400, "no dealer matched");
      const vehicle = `${opp.year ?? ""} ${opp.make ?? ""} ${opp.model ?? ""}`.trim();
      const price = typeof opp.asking_price === "number" ? `$${opp.asking_price.toLocaleString("en-AU")}` : "No price";
      await deps.store.invoke("push-send", {
        dealer_name: dealer, title: `${opp.auction_datetime ? "🔨" : "🎯"} ${opp.tier ?? ""}: ${vehicle}`,
        body: `${price} • ${opp.listing_source || "Unknown"}`, url: (opp.source_url as string) || "/", alertId: opp.id, force: true,
      });
      return { ok: true, dealer };
    }
    case "remove_anchor": {
      ownerOnly(scope);
      const id = needUuid(b.id);
      const anchor = b.anchor_sale_id;
      if (typeof anchor !== "string" || !anchor || anchor.length > 200) throw new DeskError(400, "invalid anchor");
      const opp = await deps.store.getOpp(id);
      if (!opp) throw new DeskError(404, "not found");
      const dismissed = Array.isArray(opp.dismissed_anchor_ids) ? [...(opp.dismissed_anchor_ids as string[])] : [];
      if (!dismissed.includes(anchor)) dismissed.push(anchor);
      await deps.store.updateOpp(id, {
        anchor_sale_id: null, anchor_sale_buy_price: null, anchor_sale_sell_price: null, anchor_sale_profit: null,
        anchor_sale_sold_at: null, anchor_sale_km: null, anchor_sale_trim_class: null, dismissed_anchor_ids: dismissed,
        suppress_anchor: true, updated_at: now.toISOString(),
      });
      return { ok: true };
    }
    case "finds_list": { ownerOnly(scope); return { finds: await deps.store.listFinds() }; }
    case "finds_update": {
      ownerOnly(scope);
      const id = needUuid(b.id);
      if (typeof b.status !== "string" || !FIND_STATUSES.has(b.status)) throw new DeskError(400, "invalid status");
      if (!(await deps.store.updateFind(id, { status: b.status, updated_at: now.toISOString() }))) throw new DeskError(404, "not found");
      return { ok: true };
    }
    // Owner-only for now; may become a paid dealer feature.
    case "caught_list": {
      ownerOnly(scope);
      const page = Number.isInteger(b.page) && (b.page as number) >= 0 ? Math.min(b.page as number, 1000) : 0;
      const str = (v: unknown) => (typeof v === "string" && v && v !== "all" && v.length <= 200 ? v : null);
      const status = str(b.status);
      if (status && !["live", "expired", "sold", "bought"].includes(status)) throw new DeskError(400, "invalid status");
      if (!deps.store.listCatches) return { rows: [], total: 0, page, page_size: 50 };
      return { ...(await deps.store.listCatches({ offset: page * 50, limit: 50, source: str(b.source), status })), page, page_size: 50 };
    }
    case "coverage_list": { ownerOnly(scope); return { rows: deps.store.listCoverage ? await deps.store.listCoverage() : [] }; }
    case "wbm_list": { ownerOnly(scope); return { listings: deps.store.listWbm ? await deps.store.listWbm() : [] }; }
    case "finds_scan": { ownerOnly(scope); return { ok: true, result: await deps.store.invoke("market-scanner", {}) }; }
  }
  throw new DeskError(400, "unknown action");
}
