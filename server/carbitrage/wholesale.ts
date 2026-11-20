import pg from "pg";
import { ServiceError } from "./domain.ts";
import { fetchValuation, mapGuide, type CarSpec, type Guide, type MarketApiConfig } from "./wholesale-guide.ts";

/**
 * Franchise wholesale API. Every read and write goes through the carbitrage_wholesale_*_v1 functions in
 * supabase/pending/ (service role only, keyed on the signed-in user's id). In the private preview those same functions run
 * against the box's disposable local Postgres. Nothing here emails or messages anyone. Buyer alerts are queued by the
 * database only when the franchise_buyer_alerts switch is on, and it is off.
 *
 * Who the caller is always comes from the server's own verified sign-in (Supabase JWT in production). The browser never
 * names a dealership or a buyer. The only exception is the preview-only `as` picker, which is refused outside preview.
 */

export interface WholesaleOptions {
  pool: pg.Pool;
  market: MarketApiConfig | null;
  now: () => Date;
  /** Private preview: test cars, the held list, and the `as` buyer picker. Never true in production. */
  preview: boolean;
}

export interface WholesaleResponse { status: number; body: unknown }

function bad(status: number, code: string, message: string): never {
  throw new ServiceError(status, code, message);
}

function str(body: Record<string, unknown>, key: string, max = 400): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) bad(400, "invalid_payload", `${key} is required`);
  return v.trim().slice(0, max);
}

function int(body: Record<string, unknown>, key: string, lo: number, hi: number): number {
  const v = Number(body[key]);
  if (!Number.isFinite(v) || v < lo || v > hi) bad(400, "invalid_payload", `${key} must be between ${lo} and ${hi}`);
  return Math.round(v);
}

const DB_ERRORS: Record<string, [number, string, string]> = {
  not_a_wholesale_dealer: [403, "not_a_dealer", "This sign-in is not a wholesale dealer"],
  not_an_approved_buyer: [403, "not_a_buyer", "This sign-in is not an approved buyer"],
  not_found: [404, "not_found", "No such request"],
  bid_not_found: [404, "bid_not_found", "That is not a current price on this car"],
  not_open: [409, "not_open", "This request is no longer open"],
  not_picked: [409, "not_picked", "Pick a price first"],
  locked: [409, "locked", "Price locked, the dealer has already picked"],
  floor_required: [409, "floor_held", "Held. Nothing was sent, because there is no floor yet."],
  no_buyers: [400, "no_buyers", "Pick at least one approved buyer"],
  bad_amount: [400, "invalid_payload", "That price is not valid"],
};

function mapDbError(err: unknown): never {
  if (err instanceof ServiceError) throw err;
  const e = err as { message?: string; code?: string };
  const known = Object.keys(DB_ERRORS).find((k) => e.message?.includes(k));
  if (known) bad(...DB_ERRORS[known]);
  if (e.code === "42501") bad(409, "locked", "Price locked, the dealer has already picked");
  throw err;
}

interface TestCarRow {
  rego: string; state: string; year: number; make: string; model: string; badge: string; body: string | null; colour: string | null;
  transmission: string | null; vin_masked: string | null; odometer_km: number; notes: string | null; fixture: string;
}

interface CarInput { rego: string | null; year: number; make: string; model: string; badge: string; km: number; state: string; colour: string | null; notes: string | null; fixture: string }

export function createWholesale(opts: WholesaleOptions) {
  const { pool, preview } = opts;

  async function rpc<T>(sql: string, args: unknown[]): Promise<T> {
    try {
      const r = await pool.query(sql, args);
      return r.rows[0].r as T;
    } catch (err) {
      return mapDbError(err);
    }
  }

  async function testCar(rego: string): Promise<TestCarRow> {
    const r = await pool.query<TestCarRow>("select * from preview_wholesale_test_cars where rego = $1", [rego.toUpperCase()]);
    if (!r.rows[0]) bad(404, "car_not_found", "No test car with that rego in the preview");
    return r.rows[0];
  }

  /** The car being valued. Preview test rego, or (in production) what the dealer typed: year, make, model, badge, state, km. */
  async function carFrom(body: Record<string, unknown>): Promise<CarInput> {
    const km = int(body, "km", 0, 2_000_000);
    const badgeIn = typeof body.badge === "string" && body.badge.trim() ? body.badge.trim().slice(0, 60) : undefined;
    if (preview && typeof body.rego === "string" && body.rego.trim() && !body.make) {
      const c = await testCar(body.rego);
      return { rego: c.rego, year: c.year, make: c.make, model: c.model, badge: badgeIn ?? c.badge, km, state: c.state, colour: c.colour, notes: c.notes, fixture: c.fixture };
    }
    return {
      rego: typeof body.rego === "string" && body.rego.trim() ? body.rego.trim().toUpperCase().slice(0, 12) : null,
      year: int(body, "year", 1990, 2100), make: str(body, "make", 40), model: str(body, "model", 60), badge: badgeIn ?? str(body, "badge", 60),
      km, state: str(body, "state", 3).toUpperCase(), colour: typeof body.colour === "string" ? body.colour.trim().slice(0, 40) || null : null, notes: null, fixture: "",
    };
  }

  async function valuate(c: CarInput): Promise<{ guide: Guide | null; reason: string | null; source: string; engine: unknown; route: unknown; fresh: unknown; checking: boolean }> {
    // Outside preview there is no recorded fixture to fall back on, and cars before 2020 would start a paid live search.
    if (!preview && (!opts.market || c.year < 2020)) {
      return { guide: null, reason: !opts.market ? "The valuation engine is not connected." : "Cars before 2020 need a live search, which is not switched on yet.", source: "none", engine: null, route: null, fresh: null, checking: false };
    }
    const spec: CarSpec = { year: c.year, make: c.make, model: c.model, badge: c.badge, km: c.km, state: c.state, rego: c.rego ?? undefined, fixture: c.fixture };
    const result = await fetchValuation(spec, opts.market);
    const mapped = mapGuide(result.valuation, c.year, opts.now());
    const lp = result.livePending ?? null;
    const live_check: Guide["live_check"] = lp
      ? { state: lp.timedOut ? "gave_up" : "checking", eta_seconds: lp.etaSeconds, poll_after_s: lp.pollAfterS }
      : result.route === "live_cached" || result.route === "live" ? { state: "done", eta_seconds: null, poll_after_s: 0 } : null;
    const guide = mapped ? { ...mapped, source: result.source, live_check } : null;
    let reason: string | null = null;
    if (!guide) {
      const v = result.valuation;
      reason = v.status === "pending" ? "A live search is running." : v.needs_live_search ? "Not enough fresh ads for this plate year yet." : "No floor yet.";
    }
    return { guide, reason, source: result.source, engine: result.valuation.engine ?? null, route: result.route ?? result.valuation.route ?? null, fresh: result.valuation.n_exact_year ?? null, checking: live_check?.state === "checking" };
  }

  async function previewBuyers() {
    const r = await pool.query<{ id: string; contact_name: string }>(
      "select id, contact_name from wholesale_buyers where approved and active and status = 'approved' and not is_placeholder order by created_at, contact_name",
    );
    return r.rows.map((b) => ({ id: b.id, name: b.contact_name }));
  }

  async function dealerRoute(user: string, method: string, path: string, body: Record<string, unknown>): Promise<WholesaleResponse | null> {
    if (method === "GET" && path === "/me") {
      const who = await rpc<{ dealer: { id: string; name: string } | null; buyer: { id: string; name: string } | null }>("select public.carbitrage_wholesale_whoami_v1($1) as r", [user]);
      return { status: 200, body: who };
    }
    if (method === "GET" && path === "/info") {
      const who = await rpc<{ dealer: { id: string; name: string } | null }>("select public.carbitrage_wholesale_whoami_v1($1) as r", [user]);
      if (!who.dealer) bad(403, "not_a_dealer", "This sign-in is not a wholesale dealer");
      const cars = preview ? (await pool.query<TestCarRow>("select * from preview_wholesale_test_cars order by rego")).rows : [];
      return { status: 200, body: {
        mode: preview ? "preview" : "live",
        valuationSource: opts.market ? "market_api" : "recorded",
        dealer: { name: who.dealer.name },
        manualEntry: !preview,
        testCars: cars.map((c) => ({ rego: c.rego, label: `${c.year} ${c.make} ${c.model} ${c.badge}`, km: c.odometer_km })),
      } };
    }
    if (method === "GET" && path === "/buyers") {
      return { status: 200, body: { buyers: await rpc("select public.carbitrage_wholesale_buyers_v1($1) as r", [user]) } };
    }

    if (method === "POST" && path === "/lookup") {
      if (!preview) bad(404, "no_lookup", "Rego lookup is not connected. Enter the car details.");
      const c = await testCar(str(body, "rego", 12));
      return { status: 200, body: { car: {
        rego: c.rego, state: c.state, year: c.year, make: c.make, model: c.model, badge: c.badge, body: c.body, colour: c.colour,
        transmission: c.transmission, vinMasked: c.vin_masked, odometerKm: c.odometer_km, notes: c.notes,
      } } };
    }

    if (method === "POST" && path === "/guide") {
      await rpc("select public.carbitrage_wholesale_buyers_v1($1) as r", [user]); // dealers only
      const c = await carFrom(body);
      const v = await valuate(c);
      if (preview && c.rego) {
        // A held car is remembered so the dealer's Updates list can say so. It clears the moment a floor exists.
        const dealerId = (await rpc<{ dealer: { id: string } }>("select public.carbitrage_wholesale_whoami_v1($1) as r", [user])).dealer.id;
        if (v.guide) await pool.query("update preview_wholesale_held set cleared_at = now() where dealership_id=$1 and rego=$2 and cleared_at is null", [dealerId, c.rego]);
        else {
          const open = await pool.query("update preview_wholesale_held set km=$3, badge=$4, reason=$5 where dealership_id=$1 and rego=$2 and cleared_at is null", [dealerId, c.rego, c.km, c.badge, v.reason]);
          if (!open.rowCount) await pool.query("insert into preview_wholesale_held (dealership_id, rego, km, badge, reason) values ($1,$2,$3,$4,$5)", [dealerId, c.rego, c.km, c.badge, v.reason]);
        }
      }
      return { status: 200, body: {
        held: v.guide === null, reason: v.reason, guide: v.guide, source: v.source, engine: v.engine, route: v.route, freshExactYearAds: v.fresh,
        car: { rego: c.rego, state: c.state, year: c.year, make: c.make, model: c.model, badge: c.badge, km: c.km, notes: c.notes },
      } };
    }

    if (method === "POST" && path === "/send") {
      const c = await carFrom(body);
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 600) : "";
      const approved = await rpc<Array<{ id: string }>>("select public.carbitrage_wholesale_buyers_v1($1) as r", [user]);
      const wanted = body.buyerIds === "all" ? approved.map((b) => b.id) : Array.isArray(body.buyerIds) ? (body.buyerIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const targets = approved.filter((b) => wanted.includes(b.id)).map((b) => b.id);
      if (targets.length === 0) bad(400, "no_buyers", "Pick at least one approved buyer");
      // The floor is always recomputed here. Nothing a browser sends can set it.
      const v = await valuate(c);
      if (v.guide && v.checking) {
        // The pool answer is on screen, but a live Carsales check is still running behind it. It can move the floor, so it waits.
        return { status: 409, body: { code: "live_check_running", message: "Still checking Carsales live. Try again in a minute or two, the figures may change." } };
      }
      if (!v.guide) return { status: 409, body: { code: "floor_held", message: "Held. Nothing was sent, because there is no floor yet.", reason: v.reason } };
      const out = await rpc<{ code: string; sentTo: number; alertsQueued: boolean }>(
        "select public.carbitrage_wholesale_send_v1($1, $2::jsonb, $3, $4::uuid[], $5::jsonb) as r",
        [user, JSON.stringify({ rego: c.rego, year: c.year, make: c.make, model: c.model, badge: c.badge, km: c.km, colour: c.colour, state: c.state }), note || null, targets, JSON.stringify(v.guide)],
      );
      return { status: 201, body: { code: out.code, sentTo: out.sentTo } };
    }

    if (method === "GET" && path === "/requests") {
      return { status: 200, body: { requests: await rpc("select public.carbitrage_wholesale_requests_v1($1) as r", [user]) } };
    }

    const m = path.match(/^\/requests\/(WT-[A-Z0-9]{6})(?:\/(pick|keep|collected))?$/);
    if (m) {
      if (method === "GET" && !m[2]) {
        const one = await rpc<Record<string, unknown> | null>("select public.carbitrage_wholesale_requests_v1($1, $2) as r", [user, m[1]]);
        if (!one) bad(404, "not_found", "No such request");
        return { status: 200, body: one };
      }
      if (method === "POST" && m[2] === "pick") {
        const out = await rpc("select public.carbitrage_wholesale_pick_v1($1, $2, $3::uuid) as r", [user, m[1], str(body, "bidId", 64)]);
        return { status: 200, body: out };
      }
      if (method === "POST" && m[2] === "keep") return { status: 200, body: await rpc("select public.carbitrage_wholesale_keep_v1($1, $2) as r", [user, m[1]]) };
      if (method === "POST" && m[2] === "collected") return { status: 200, body: await rpc("select public.carbitrage_wholesale_collected_v1($1, $2) as r", [user, m[1]]) };
    }

    if (method === "GET" && path === "/updates") {
      const list = await rpc<Array<Record<string, any>>>("select public.carbitrage_wholesale_requests_v1($1) as r", [user]);
      const events: Array<{ at: string; rego: string | null; car: string; status: string; text: string }> = [];
      if (preview) {
        const dealerId = (await rpc<{ dealer: { id: string } }>("select public.carbitrage_wholesale_whoami_v1($1) as r", [user])).dealer.id;
        const held = await pool.query("select h.*, t.year, t.model, t.badge as tbadge from preview_wholesale_held h join preview_wholesale_test_cars t on t.rego = h.rego where h.dealership_id = $1 and h.cleared_at is null order by h.created_at desc", [dealerId]);
        for (const h of held.rows) events.push({ at: h.created_at.toISOString(), rego: h.rego, car: `${h.year} ${h.model} ${h.tbadge}`, status: "held", text: "Held, no floor yet." });
      }
      const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
      for (const t of list) {
        const car = `${t.car.year} ${t.car.model} ${t.car.badge}`;
        const rego = t.car.rego as string | null;
        const prices = t.prices as Array<{ bidId: string; name: string; amountCents: number; at: string }>;
        events.push({ at: t.createdAt, rego, car, status: "waiting", text: `Sent to ${t.sentTo.length} buyer${t.sentTo.length === 1 ? "" : "s"}.` });
        if (prices.length) {
          const last = prices.reduce((a, b) => (a.at > b.at ? a : b));
          events.push({ at: last.at, rego, car, status: "prices", text: `${prices.length} price${prices.length === 1 ? "" : "s"} in. Best ${dollars(prices[0].amountCents)}.` });
        }
        const buyerName = prices.find((p) => p.bidId === t.acceptedBidId)?.name;
        if (t.status === "accepted") {
          events.push({ at: t.updatedAt, rego, car, status: t.outcome === "completed" ? "handover" : "picked",
            text: t.outcome === "completed" ? `Sold to ${buyerName ?? "the buyer"} for ${dollars(t.finalSaleCents ?? 0)}.` : `You picked ${buyerName ?? "a buyer"} at ${dollars(t.finalSaleCents ?? 0)}.` });
        }
        if (t.status === "declined") events.push({ at: t.updatedAt, rego, car, status: "picked", text: "You kept the car." });
      }
      events.sort((a, b) => b.at.localeCompare(a.at));
      return { status: 200, body: { updates: events } };
    }
    return null;
  }

  async function buyerUser(signedIn: string | null, query: URLSearchParams, body: Record<string, unknown>): Promise<string> {
    if (preview) {
      // Preview-only picker so one person can try all four buyers. Production never reads `as`.
      const asId = query.get("as") ?? (typeof body.as === "string" ? body.as : null);
      if (asId) {
        const r = await pool.query<{ user_id: string | null }>("select user_id from wholesale_buyers where id = $1", [asId]);
        if (!r.rows[0]?.user_id) bad(403, "not_a_buyer", "Not an approved buyer");
        return r.rows[0].user_id;
      }
    }
    if (!signedIn) bad(401, "unauthenticated", "Sign in required");
    return signedIn;
  }

  async function buyerRoute(signedIn: string | null, method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<WholesaleResponse | null> {
    if (method === "GET" && path === "/buyer/list") {
      if (!preview) bad(404, "not_found", "No such wholesale route");
      return { status: 200, body: { buyers: await previewBuyers() } };
    }
    const user = await buyerUser(signedIn, query, body);
    if (method === "GET" && path === "/buyer/cars") return { status: 200, body: await rpc("select public.carbitrage_wholesale_buyer_cars_v1($1) as r", [user]) };
    if (method === "POST" && path === "/buyer/price") {
      const code = str(body, "code", 12);
      const dollars = int(body, "amountDollars", 1, 2_000_000);
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
      await rpc("select public.carbitrage_wholesale_buyer_price_v1($1, $2, $3, $4) as r", [user, code, dollars, note]);
      return { status: 201, body: { ok: true } };
    }
    if (method === "GET" && path === "/buyer/history") return { status: 200, body: await rpc("select public.carbitrage_wholesale_buyer_history_v1($1) as r", [user]) };
    return null;
  }

  return {
    /**
     * signedIn is the verified user id from the server's own sign-in, or null. In preview a persona session is mapped to a
     * fixed preview user by the caller; in production it is the Supabase user id from the verified JWT.
     */
    async handle(side: "dealer" | "buyer", signedIn: string | null, method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<WholesaleResponse> {
      let found: WholesaleResponse | null;
      if (side === "buyer") found = await buyerRoute(signedIn, method, path, query, body);
      else {
        if (!signedIn) bad(401, "unauthenticated", "Sign in required");
        found = await dealerRoute(signedIn, method, path, body);
      }
      if (!found) bad(404, "not_found", "No such wholesale route");
      return found;
    },
  };
}

export type Wholesale = ReturnType<typeof createWholesale>;
