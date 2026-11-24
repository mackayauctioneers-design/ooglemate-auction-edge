// operator-desk core: verified Ooglecars identity -> yard scope -> allow-listed Trading Desk actions.
// Pure module (no Deno/npm imports) so the same code runs in the edge function and in node tests.
// The browser never sends a yard: scope comes only from verified dealership membership + yard_links + owner_access.

export const ACTIONABLE_STATUSES = ["new", "assigned", "reviewed"] as const;
const STATUSES = new Set(["new", "assigned", "reviewed", "purchased", "passed", "expired", "lost", "watching"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Claims = { sub?: unknown; exp?: unknown; iss?: unknown; aud?: unknown };
/** jose-compatible verifier: must check signature, issuer, audience and expiry, and throw on any failure. */
export type VerifyJwt = (token: string) => Promise<{ payload: Claims }>;
export type Membership = { dealership_id: string; role?: string };
export type Opp = Record<string, unknown> & { id: string; best_account_id?: string | null; assigned_to_account?: string | null; alt_matches?: unknown };

export interface DeskStore {
  isOwner(ooglecarsUserId: string): Promise<boolean>;
  yardAccounts(dealershipIds: string[]): Promise<string[]>;
  accounts(ids: string[] | null): Promise<{ id: string; display_name: string }[]>;
  listOpps(q: { accountIds: string[] | null; focus: string | null; freshFloor: string; activeLimit: number; starredLimit: number }): Promise<{ active: Opp[]; starred: Opp[] }>;
  getOpp(id: string): Promise<Opp | null>;
  updateOpp(id: string, patch: Record<string, unknown>): Promise<void>;
}
export type Deps = { verify: VerifyJwt; memberships: (token: string, sub: string) => Promise<Membership[]>; store: DeskStore; now?: () => Date };

export class DeskError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

/** null accountIds = owner (all yards, including unassigned cars). */
export type Scope = { userId: string; owner: boolean; accountIds: string[] | null; linkedYards: number; memberships: number };

export async function resolveScope(token: string, deps: Deps): Promise<Scope> {
  if (!token || token.split(".").length !== 3) throw new DeskError(401, "unauthorized");
  let claims: Claims;
  try { claims = (await deps.verify(token)).payload; } catch { throw new DeskError(401, "unauthorized"); }
  const sub = claims.sub;
  const exp = claims.exp;
  const nowSec = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  // Belt and braces on top of the verifier's own expiry check.
  if (typeof sub !== "string" || !UUID.test(sub) || typeof exp !== "number" || exp <= nowSec) throw new DeskError(401, "unauthorized");
  if (await deps.store.isOwner(sub)) return { userId: sub, owner: true, accountIds: null, linkedYards: 0, memberships: 0 };
  const rows = await deps.memberships(token, sub);
  const dealershipIds = [...new Set(rows.map((r) => r.dealership_id).filter((d): d is string => typeof d === "string" && d.length > 0))];
  const accountIds = dealershipIds.length ? [...new Set(await deps.store.yardAccounts(dealershipIds))] : [];
  return { userId: sub, owner: false, accountIds, linkedYards: accountIds.length, memberships: dealershipIds.length };
}

export function inScope(scope: Scope, opp: Opp): boolean {
  if (scope.accountIds === null) return true;
  const yards = new Set(scope.accountIds);
  return (!!opp.best_account_id && yards.has(opp.best_account_id)) || (!!opp.assigned_to_account && yards.has(opp.assigned_to_account));
}

/** Dealers never see other yards' alternative matches. */
export function redact(scope: Scope, opp: Opp): Opp {
  if (scope.accountIds === null) return opp;
  const yards = new Set(scope.accountIds);
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

export async function handleDesk(token: string, body: unknown, deps: Deps): Promise<unknown> {
  const scope = await resolveScope(token, deps);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = b.action;
  const now = deps.now?.() ?? new Date();
  const desk = scope.owner || (scope.accountIds?.length ?? 0) > 0;
  if (action === "whoami") {
    const accounts = desk ? await deps.store.accounts(scope.accountIds) : [];
    return { owner: scope.owner, desk, has_membership: scope.memberships > 0, accounts };
  }
  if (!desk) throw new DeskError(403, "forbidden");
  if (action === "list") {
    let focus: string | null = null;
    if (b.account_id !== undefined && b.account_id !== null && b.account_id !== "all") {
      if (typeof b.account_id !== "string" || !UUID.test(b.account_id)) throw new DeskError(400, "invalid account");
      if (scope.accountIds !== null && !scope.accountIds.includes(b.account_id)) throw new DeskError(403, "forbidden");
      focus = b.account_id;
    }
    const freshFloor = new Date(now.getTime() - 14 * 86400000).toISOString();
    const scoped = focus !== null || scope.accountIds !== null;
    const { active, starred } = await deps.store.listOpps({ accountIds: scope.accountIds, focus, freshFloor, activeLimit: scoped ? 1000 : 500, starredLimit: scoped ? 500 : 100 });
    const ids = new Set(active.map((o) => o.id));
    // Re-check every row server-side even though the store already filtered.
    const opportunities = [...active, ...starred.filter((o) => !ids.has(o.id))].filter((o) => inScope(scope, o)).map((o) => redact(scope, o));
    return { owner: scope.owner, opportunities, accounts: await deps.store.accounts(scope.accountIds) };
  }
  if (action === "update") {
    if (typeof b.id !== "string" || !UUID.test(b.id)) throw new DeskError(400, "invalid id");
    const opp = await deps.store.getOpp(b.id);
    if (!opp || !inScope(scope, opp)) throw new DeskError(403, "forbidden");
    const patch = parsePatch(scope, b.patch, await deps.store.accounts(scope.accountIds), now);
    await deps.store.updateOpp(b.id, patch);
    return { ok: true, patch };
  }
  throw new DeskError(400, "unknown action");
}
