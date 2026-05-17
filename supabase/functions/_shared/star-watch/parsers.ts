/**
 * Source-aware HTML parsers for the internal star-watch worker.
 * Day-1 priority: detect status (active/sold/removed/blocked) reliably,
 * extract whatever structured fields are recoverable via JSON-LD + regex.
 * Never throws — always returns a ParseResult.
 */

export type WatchStatus = "active" | "sold" | "removed" | "blocked";

export interface ParseResult {
  status: WatchStatus;
  title: string | null;
  price_aud: number | null;
  odometer_km: number | null;
  year: number | null;
  state: string | null;
  seller_name: string | null;
  source_id: string | null;
  notes: string | null;
  source: string;
  debug?: string;
}

const REMOVED_PATTERNS = [
  /sorry.*car.*(?:you were looking for has been|removed)/i,
  /listing.*no longer (?:available|active)/i,
  /this vehicle has been sold/i,
  /this listing has ended/i,
  /page not found/i,
  /we couldn.t find that listing/i,
  /vehicle is no longer available/i,
];

const SOLD_PATTERNS = [
  /\bsold\b/i,
  /\bunder offer\b/i,
  /\bsale pending\b/i,
];

const BLOCKED_PATTERNS = [
  /access denied/i,
  /attention required.*cloudflare/i,
  /please enable cookies/i,
  /captcha/i,
  /just a moment\.{3}/i,
  /<title>\s*403/i,
];

function detectSource(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("carsales.com.au")) return "carsales";
  if (u.includes("autotrader.com.au")) return "autotrader";
  if (u.includes("gumtree.com.au")) return "gumtree";
  if (u.includes("pickles.com.au")) return "pickles";
  if (u.includes("graysonline.com") || u.includes("grays.com")) return "grays";
  if (u.includes("manheim.com.au")) return "manheim";
  return "dealer";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch { /* ignore */ }
  }
  return out;
}

function pickVehicleJsonLd(blocks: any[]): any | null {
  for (const b of blocks) {
    const t = b?.["@type"];
    if (t === "Vehicle" || t === "Car" || t === "Product") return b;
    if (Array.isArray(t) && (t.includes("Vehicle") || t.includes("Car") || t.includes("Product"))) return b;
  }
  return null;
}

function firstMatch(re: RegExp, html: string): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? m[0]) : null;
}

export function parseListingHtml(url: string, status: number, html: string): ParseResult {
  const source = detectSource(url);
  const base: ParseResult = {
    status: "active",
    title: null, price_aud: null, odometer_km: null, year: null,
    state: null, seller_name: null, source_id: null, notes: null, source,
  };

  if (status === 404 || status === 410) {
    return { ...base, status: "removed", debug: `http_${status}` };
  }
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return { ...base, status: "blocked", debug: `http_${status}` };
  }

  const snippet = html.slice(0, 60_000);

  if (BLOCKED_PATTERNS.some((p) => p.test(snippet))) {
    return { ...base, status: "blocked", debug: snippet.slice(0, 500) };
  }
  if (REMOVED_PATTERNS.some((p) => p.test(snippet))) {
    return { ...base, status: "removed" };
  }

  // ── JSON-LD extraction (covers Carsales, Autotrader, many dealer CMSs) ──
  const ld = pickVehicleJsonLd(extractJsonLd(html));
  if (ld) {
    base.title = (ld.name || ld.headline || null) as string | null;
    base.price_aud =
      toNum(ld?.offers?.price) ||
      toNum(ld?.offers?.lowPrice) ||
      toNum(ld?.price);
    base.odometer_km =
      toNum(ld?.mileageFromOdometer?.value) ||
      toNum(ld?.vehicleOdometer?.value);
    base.year = toNum(ld?.vehicleModelDate || ld?.modelDate || ld?.productionDate);
    base.seller_name = ld?.seller?.name || ld?.brand?.name || null;
    base.source_id = (ld?.sku || ld?.productID || ld?.identifier || null) as string | null;
    const avail = String(ld?.offers?.availability || "").toLowerCase();
    if (avail.includes("soldout") || avail.includes("discontinued")) base.status = "sold";
  }

  // ── Title fallback ──
  if (!base.title) {
    base.title = firstMatch(/<title>([^<]+)<\/title>/i, html)?.trim() || null;
  }

  // ── Generic regex fallbacks ──
  if (!base.price_aud) {
    const m = firstMatch(/\$\s?([0-9]{2,3}(?:,[0-9]{3})+|[0-9]{4,6})/, html);
    base.price_aud = toNum(m);
  }
  if (!base.odometer_km) {
    const m = firstMatch(/([0-9]{1,3}(?:,?[0-9]{3})?)\s*(?:km|kms|kilometres)/i, html);
    base.odometer_km = toNum(m);
  }
  if (!base.year && base.title) {
    const m = base.title.match(/\b(19[89]\d|20[0-3]\d)\b/);
    if (m) base.year = Number(m[1]);
  }
  if (!base.state) {
    const m = firstMatch(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/, html);
    if (m) base.state = m.toUpperCase();
  }

  // ── Source-id from URL when not in JSON-LD ──
  if (!base.source_id) {
    const m = url.match(/[?&-/](?:id|listingId|vehicleId|lot|item)[=/]([A-Za-z0-9-]+)/);
    if (m) base.source_id = m[1];
    else {
      const tail = url.split("?")[0].split("/").filter(Boolean).pop();
      if (tail && /[A-Za-z0-9]/.test(tail)) base.source_id = tail.slice(0, 64);
    }
  }

  // ── Sold detection (post-availability) ──
  if (base.status === "active" && SOLD_PATTERNS.some((p) => p.test(snippet))) {
    // Avoid false-positives on "Sold" in nav menus by requiring proximity to price/title heading
    if (/sold/i.test(snippet.slice(0, 8000))) base.status = "sold";
  }

  return base;
}
