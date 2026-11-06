/**
 * Canonical types for the standalone Carbitrage portal.
 * Website handlers and MCP tools both use these shapes.
 * Yard scope is never taken from an unauthenticated caller.
 */

export const SOURCE_CHANNELS = [
  "auction",
  "fleet_lease",
  "government",
  "dealer_retail",
  "aged_stock",
  "wholesale_trade",
  "private",
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const FIND_STATUSES = ["new", "watching", "shortlisted", "passed"] as const;
export type FindStatus = (typeof FIND_STATUSES)[number];

export const YARD_KINDS = ["standalone_franchise", "group_store", "ooglecars_addon"] as const;
export type YardKind = (typeof YARD_KINDS)[number];

export const MEMBER_ROLES = ["dealer", "group_admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const VARIANT_MATCHES = ["matched", "unmatched", "insufficient_evidence"] as const;
export type VariantMatch = (typeof VARIANT_MATCHES)[number];

export const DEMO_NOW = new Date("2026-11-06T00:00:00.000Z");
/** Six calendar-ish months. Inclusive at the cutoff instant. */
export const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}

export interface Yard {
  id: string;
  name: string;
  kind: YardKind;
  groupId: string | null;
  /** Null when the yard does not use Ooglecars. Standalone franchise leaves this null. */
  ooglecarsYardId: string | null;
  region: string;
  franchise: string | null;
}

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
}

export interface Membership {
  userId: string;
  yardId: string;
  role: MemberRole;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  tokenHash: string;
  label: string;
  createdAt: string;
}

export interface IngestPrincipal {
  id: string;
  name: string;
  tokenHash: string;
  /** Yards this ingest identity is allowed to write. The payload yard must be in this set. */
  yardIds: string[];
}

export interface Opportunity {
  id: string;
  yardId: string;
  synthetic: boolean;
  externalId: string;
  sourceSystem: string;
  sourceChannel: SourceChannel;
  sourceUrl: string;
  sourceLabel: string;
  capturedAt: string;
  year: number | null;
  make: string;
  model: string;
  variant: string | null;
  variantMatch: VariantMatch;
  odometerKm: number | null;
  askingPrice: number | null;
  floorExGov: number | null;
  floorSource: string | null;
  floorAsOf: string | null;
  governmentChargesExcluded: true;
  photoUrl: string | null;
  photoCredit: string | null;
  /** illustrative = not the listed vehicle. listing = the seller's own image. */
  photoUse: "illustrative" | "listing" | "none";
  listingPhotoUrl: string | null;
  status: FindStatus;
  watchlisted: boolean;
  sourceEnvelope: Record<string, unknown>;
  evidence: EvidenceItem[];
  ingestedAt: string;
  dedupeKey: string;
}

export interface EvidenceItem {
  label: string;
  detail: string;
}

export interface SaleRecord {
  id: string;
  yardId: string;
  dedupeKey: string;
  stockNo: string | null;
  soldAt: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  odometerKm: number | null;
  price: number;
  /** ex_gov means government charges were excluded on this recorded sale. */
  priceBasis: "ex_gov" | "unknown";
  synthetic: boolean;
  adapter: string;
}

export interface Mandate {
  id: string;
  yardId: string;
  make: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  kmMax: number | null;
  notes: string;
  active: boolean;
  derivedFrom: "sales_import" | "manual";
  synthetic: boolean;
}

export interface AlertRecord {
  id: string;
  yardId: string;
  opportunityId: string;
  kind: "under_floor" | "mandate_match";
  message: string;
  createdAt: string;
  read: boolean;
}

export interface IngestReceipt {
  dedupeKey: string;
  opportunityId: string;
  yardId: string;
  attempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
  priceChangedIgnored: boolean;
}

export interface PublicFact {
  id: string;
  fact: string;
  synthetic: boolean;
}

export interface Snapshot {
  yards: Yard[];
  users: UserAccount[];
  memberships: Membership[];
  opportunities: Opportunity[];
  sales: SaleRecord[];
  mandates: Mandate[];
  alerts: AlertRecord[];
  receipts: IngestReceipt[];
  apiKeys: ApiKeyRecord[];
  ingestPrincipals: IngestPrincipal[];
  publicFacts: PublicFact[];
}

export interface Store {
  snapshot(): Snapshot;
  mutate(fn: (draft: Snapshot) => void): void;
}

export type Principal =
  | { kind: "user"; userId: string }
  | { kind: "ingest"; principalId: string };

export function assertNever(value: never, label = "variant"): never {
  throw new ServiceError(500, "unhandled_variant", `Unhandled ${label}`);
}

export function isSourceChannel(value: unknown): value is SourceChannel {
  return typeof value === "string" && (SOURCE_CHANNELS as readonly string[]).includes(value);
}

export function isFindStatus(value: unknown): value is FindStatus {
  return typeof value === "string" && (FIND_STATUSES as readonly string[]).includes(value);
}

export function isVariantMatch(value: unknown): value is VariantMatch {
  return typeof value === "string" && (VARIANT_MATCHES as readonly string[]).includes(value);
}

export function channelLabel(channel: SourceChannel): string {
  switch (channel) {
    case "auction":
      return "Auction";
    case "fleet_lease":
      return "Fleet / lease";
    case "government":
      return "Government";
    case "dealer_retail":
      return "Dealer retail";
    case "aged_stock":
      return "Aged stock";
    case "wholesale_trade":
      return "Wholesale / trade";
    case "private":
      return "Private seller";
    default:
      return assertNever(channel, "source channel");
  }
}

export interface FloorDisplay {
  floorExGov: number | null;
  floorSource: string | null;
  floorAsOf: string | null;
  note: string;
}

/**
 * A floor is shown only from this yard's own recent sales of the same
 * make, model and variant, recorded ex-government charges.
 * A stored claim is not used, so a floor cannot cite sales that are not there.
 */
export function displayedFloor(
  opp: Pick<Opportunity, "yardId" | "make" | "model" | "variant" | "variantMatch">,
  sales: SaleRecord[],
  now: Date,
): FloorDisplay {
  const variant = opp.variant;
  if (opp.variantMatch !== "matched" || !variant) {
    return {
      floorExGov: null,
      floorSource: null,
      floorAsOf: null,
      note: "No floor. The variant was not matched, so no price was applied.",
    };
  }
  const rows = sales.filter(
    (sale) =>
      sale.yardId === opp.yardId &&
      sale.priceBasis === "ex_gov" &&
      sale.make.toLowerCase() === opp.make.toLowerCase() &&
      sale.model.toLowerCase() === opp.model.toLowerCase() &&
      (sale.variant ?? "").toLowerCase() === variant.toLowerCase() &&
      isRecentSale(sale.soldAt, now),
  );
  if (rows.length === 0) {
    return {
      floorExGov: null,
      floorSource: null,
      floorAsOf: null,
      note: "No floor. There is no matching own sale recorded ex-government charges.",
    };
  }
  const prices = rows.map((sale) => sale.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 1 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  const latest = rows.map((sale) => sale.soldAt).sort().at(-1) ?? "";
  return {
    floorExGov: median,
    floorSource: `Own-sale median of ${rows.length} ${opp.make} ${opp.model} ${variant} sale${rows.length === 1 ? "" : "s"} in the last 6 months, recorded ex-government charges. Not a VALO market range and not a fingerprint margin.`,
    floorAsOf: latest.slice(0, 10),
    note: `This number is the median of the same recent own sale${rows.length === 1 ? "" : "s"} of this variant. VALO market range needs at least 3 comps. Fingerprint margin is retail truth minus cost. Neither is applied here.`,
  };
}

export function underFloorPct(asking: number | null, floor: number | null): number | null {
  if (asking == null || floor == null || floor <= 0) return null;
  if (asking >= floor) return null;
  return Math.round(((floor - asking) / floor) * 1000) / 10;
}

export function isRecentSale(soldAt: string, now: Date): boolean {
  const t = new Date(soldAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= now.getTime() - SIX_MONTHS_MS;
}

export function freshness(capturedAt: string, now: Date): string {
  const t = new Date(capturedAt).getTime();
  if (Number.isNaN(t)) return "Capture time unknown";
  const ageH = Math.max(0, Math.round((now.getTime() - t) / 3_600_000));
  if (ageH < 1) return "Captured less than an hour ago";
  if (ageH < 48) return `Captured ${ageH} hours ago`;
  const days = Math.round(ageH / 24);
  return `Captured ${days} days ago`;
}

export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceError(400, "invalid_payload", "Source URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ServiceError(400, "invalid_payload", "Source URL must be http or https");
  }
  if (url.hostname.toLowerCase().includes("autograb")) {
    throw new ServiceError(400, "autograb_blocked", "AutoGrab links are not stored");
  }
  return url;
}

export function allowedYardIds(snapshot: Snapshot, principal: Principal): string[] {
  if (principal.kind === "ingest") {
    const row = snapshot.ingestPrincipals.find((p) => p.id === principal.principalId);
    return row ? [...row.yardIds] : [];
  }
  return snapshot.memberships.filter((m) => m.userId === principal.userId).map((m) => m.yardId);
}

export function requireYard(snapshot: Snapshot, principal: Principal, yardId: string): void {
  const allowed = allowedYardIds(snapshot, principal);
  if (!allowed.includes(yardId)) {
    throw new ServiceError(403, "yard_forbidden", "This account cannot access that yard");
  }
}

export function aud(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}
