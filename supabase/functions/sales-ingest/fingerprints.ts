// Shared with tests. This adapter maps VPS data; it never scores or qualifies cars.
export type FingerprintCell = {
  level: "group" | "mandate" | "exact";
  cell_key: string;
  make: string;
  model: string;
  badge: string;
  year_min: number;
  year_max: number;
  km_max: number | null;
  n_sales_120: number;
  avg_gross_120: number | null;
  updated_at: string;
};

export class FingerprintInputError extends Error {}
export class FingerprintRetryError extends Error {}

const FIELDS = new Set([
  "level", "cell_key", "make", "model", "badge", "year_min", "year_max", "km_max",
  "n_sales_120", "avg_gross_120", "updated_at",
]);
const ENVELOPE_FIELDS = new Set(["action", "account_id", "rows"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number, blank = false): value is string {
  return typeof value === "string" && value.length <= max && (blank || value.trim().length > 0);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function fingerprintId(account: string, cell: Pick<FingerprintCell, "level" | "cell_key">): string {
  // JSON tuple encoding avoids delimiter collisions; km_band is NOT a key component.
  return `vps-winner:${JSON.stringify([account.toLowerCase(), cell.level, cell.cell_key])}`;
}

export function parseFingerprints(body: unknown): { account: string; cells: FingerprintCell[] } {
  if (!record(body) || Object.keys(body).some((key) => !ENVELOPE_FIELDS.has(key))) {
    throw new FingerprintInputError("invalid_fingerprint_envelope");
  }
  if (body.action !== "fingerprints" || typeof body.account_id !== "string" || !UUID.test(body.account_id)) {
    throw new FingerprintInputError("invalid_fingerprint_account");
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 600) {
    throw new FingerprintInputError("rows_required_1_to_600");
  }
  const account = body.account_id.toLowerCase();
  const keys = new Set<string>();
  const cells: FingerprintCell[] = [];
  for (const [index, value] of body.rows.entries()) {
    if (!record(value) || Object.keys(value).some((key) => !FIELDS.has(key))) {
      // Do not echo private field names/values from rejected raw VPS rows.
      throw new FingerprintInputError(`unknown_fingerprint_field_at_${index}`);
    }
    const { level, cell_key, make, model, badge, year_min, year_max, km_max, n_sales_120, avg_gross_120, updated_at } = value;
    if ((level !== "group" && level !== "mandate" && level !== "exact") ||
      !text(cell_key, 200) || !text(make, 100) || !text(model, 150) || !text(badge, 150, true) ||
      !integer(year_min, 1886, 2200) || !integer(year_max, year_min, 2200) ||
      !(km_max === null || integer(km_max, 0, 10_000_000)) ||
      !integer(n_sales_120, 0, 2_147_483_647) ||
      !(avg_gross_120 === null || (typeof avg_gross_120 === "number" && Number.isFinite(avg_gross_120))) ||
      !text(updated_at, 40) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(updated_at) ||
      !Number.isFinite(Date.parse(updated_at))) {
      throw new FingerprintInputError(`invalid_fingerprint_row_at_${index}`);
    }
    if (n_sales_120 === 0 && avg_gross_120 !== null) {
      throw new FingerprintInputError(`mean_without_recent_sales_at_${index}`);
    }
    const cell: FingerprintCell = { level, cell_key, make, model, badge, year_min, year_max, km_max, n_sales_120, avg_gross_120, updated_at };
    const id = fingerprintId(account, cell);
    if (keys.has(id)) throw new FingerprintInputError(`duplicate_fingerprint_at_${index}`);
    keys.add(id);
    cells.push(cell);
  }
  return { account, cells };
}

export type DealerProfile = { id: string; account_id: string; dealer_name: string };
export function fingerprintMetrics(account: string, profile: DealerProfile, cell: FingerprintCell) {
  if (profile.account_id.toLowerCase() !== account.toLowerCase()) throw new FingerprintInputError("profile_account_mismatch");
  return {
    fingerprint_id: fingerprintId(account, cell),
    dealer_profile_id: profile.id,
    dealer_name: profile.dealer_name,
    make: cell.make,
    model: cell.model,
    variant_family: cell.badge || null,
    year_min: cell.year_min,
    year_max: cell.year_max,
    max_km: cell.km_max,
    sales_count: cell.n_sales_120,
    avg_profit: cell.avg_gross_120,
    // med_days is a median, not an average. Do not invent a days-to-sell figure.
    avg_days_to_sell: null,
    updated_at: cell.updated_at,
  };
}

export type FingerprintMetrics = ReturnType<typeof fingerprintMetrics>;
export type ExistingFingerprint = Omit<FingerprintMetrics, "dealer_profile_id"> & { dealer_profile_id: string | null };
export type NewFingerprint = FingerprintMetrics & { is_active: false; alert_enabled: false };
export interface FingerprintStore {
  profiles(account: string): Promise<DealerProfile[]>;
  existing(ids: string[]): Promise<ExistingFingerprint[]>;
  insert(row: NewFingerprint): Promise<boolean>;
  update(row: FingerprintMetrics, previousTimestamp: string): Promise<boolean>;
}

export async function receiveFingerprints(body: unknown, allowed: ReadonlySet<string>, store: FingerprintStore, now = Date.now) {
  const started = now();
  const { account, cells } = parseFingerprints(body);
  if (!allowed.has(account)) throw new FingerprintInputError("account_not_allowed");
  const profiles = await store.profiles(account);
  if (profiles.length !== 1) throw new FingerprintInputError("dealer_profile_required");
  const profile = profiles[0];
  if (!profile || profile.account_id.toLowerCase() !== account) throw new FingerprintInputError("profile_account_mismatch");
  const existing = new Map((await store.existing(cells.map((cell) => fingerprintId(account, cell)))).map((row) => [row.fingerprint_id, row]));
  // Validate the whole batch's ownership before any write.
  for (const row of existing.values()) {
    if (row.dealer_profile_id !== profile.id) throw new FingerprintInputError("fingerprint_profile_mismatch");
  }
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const cell of cells) {
    if (now() - started >= 110_000) return { received: cells.length, inserted, updated, skipped, retry_required: true };
    const metrics = fingerprintMetrics(account, profile, cell);
    const prior = existing.get(metrics.fingerprint_id);
    const sameMetrics = prior && (Object.keys(metrics) as (keyof FingerprintMetrics)[])
      .every((key) => key === "updated_at" || prior[key] === metrics[key]);
    if (sameMetrics) {
      skipped++;
    } else if (prior) {
      // updated_at is server-managed. Use it only for concurrency, not as a VPS cursor.
      if (await store.update(metrics, prior.updated_at)) updated++;
      else return { received: cells.length, inserted, updated, skipped, retry_required: true };
    } else {
      // Import is not approval to activate a buying target or enable dealer alerts.
      if (await store.insert({ ...metrics, is_active: false, alert_enabled: false })) inserted++;
      else return { received: cells.length, inserted, updated, skipped, retry_required: true };
    }
  }
  return { received: cells.length, inserted, updated, skipped, retry_required: false };
}