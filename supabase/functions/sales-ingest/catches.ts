// Pure parsers for the finder_catches and source_coverage push actions (no Deno/npm imports; node-tested).
export const KNOWN_ACTIONS = new Set(["fingerprints_deactivate", "fingerprints", "existing", "finder_catches", "source_coverage"]);
export const MAX_ROWS = 300;

export class CatchInputError extends Error {
  extra: Record<string, unknown>;
  constructor(message: string, extra: Record<string, unknown> = {}) { super(message); this.extra = extra; }
}

type Kind = "text" | "int" | "num" | "bool" | "ts" | "texts" | "date" | "sales";
const CATCH_FIELDS: Record<string, Kind> = {
  catch_id: "text", found_at: "ts", updated_at: "ts", source: "text", finder: "text", finders: "texts", url: "text",
  year: "int", make: "text", model: "text", badge: "text", km: "int", state: "text", seller_type: "text",
  ask: "num", floor: "num", gap_dollars: "num", gap_pct: "num", floor_basis: "text", engine_confidence: "text",
  comp_count: "int", check_this: "bool", closes_at: "ts", alert_line: "text", alerted_to: "text", alerted_at: "ts",
  status: "text", corrected: "bool",
};
const COVERAGE_FIELDS: Record<string, Kind> = {
  date: "date", source: "text", listings_scanned: "int", new: "int", errors: "int", catches: "int", quiet: "bool",
  well_below_market_flagged: "int", sales: "sales",
};
export const CATCH_STATUSES = new Set(["live", "expired", "sold", "bought"]);
const isTs = (v: unknown) => typeof v === "string" && v.length >= 10 && Number.isFinite(Date.parse(v));

function valid(kind: Kind, v: unknown): boolean {
  if (v === null) return true;
  switch (kind) {
    case "text": return typeof v === "string" && v.length <= 2000;
    case "int": return typeof v === "number" && Number.isInteger(v);
    case "num": return typeof v === "number" && Number.isFinite(v);
    case "bool": return typeof v === "boolean";
    case "ts": return isTs(v);
    case "texts": return Array.isArray(v) && v.length <= 50 && v.every((s) => typeof s === "string");
    case "date": return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
    case "sales": return Array.isArray(v) && v.length <= 200 && v.every((s) => s && typeof s === "object" && !Array.isArray(s)
      && Object.keys(s).every((k) => ["sale", "lots", "closes_at"].includes(k))
      && typeof (s as any).sale === "string"
      && ((s as any).lots == null || Number.isInteger((s as any).lots))
      && ((s as any).closes_at == null || isTs((s as any).closes_at)));
  }
}

function parseRows(rows: unknown, fields: Record<string, Kind>, required: string[]): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new CatchInputError("rows_required_1_to_300");
  return rows.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new CatchInputError("bad_row", { row: i });
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const kind = fields[k];
      if (!kind) throw new CatchInputError("unknown_field", { row: i, field: k });
      if (v === undefined) continue;
      if (!valid(kind, v)) throw new CatchInputError("bad_value", { row: i, field: k });
      out[k] = v;
    }
    for (const k of required) if (out[k] == null || out[k] === "") throw new CatchInputError("missing_required", { row: i, field: k });
    return out;
  });
}

export function parseCatches(rows: unknown) {
  const out = parseRows(rows, CATCH_FIELDS, ["catch_id", "found_at", "source"]);
  out.forEach((r, i) => { if (r.status != null && !CATCH_STATUSES.has(r.status as string)) throw new CatchInputError("bad_value", { row: i, field: "status" }); });
  if (new Set(out.map((r) => r.catch_id)).size !== out.length) throw new CatchInputError("duplicate_catch_id");
  return out;
}

export function parseCoverage(rows: unknown) {
  const out = parseRows(rows, COVERAGE_FIELDS, ["date", "source"]);
  if (new Set(out.map((r) => `${r.date}\u0000${r.source}`)).size !== out.length) throw new CatchInputError("duplicate_date_source");
  return out;
}

/** Split an upsert batch into inserted vs updated using the keys that already existed before the write. */
export function countUpsert(keys: string[], existing: Set<string>) {
  const updated = keys.filter((k) => existing.has(k)).length;
  return { inserted: keys.length - updated, updated };
}
