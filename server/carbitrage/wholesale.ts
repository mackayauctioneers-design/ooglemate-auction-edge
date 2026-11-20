import pg from "pg";
import { ServiceError } from "./domain.ts";
import { fetchValuation, mapGuide, type CarSpec, type Guide, type MarketApiConfig, type ValuationResult } from "./wholesale-guide.ts";

/**
 * Franchise wholesale preview API. Runs only against the box's disposable local Postgres (mirror of the production
 * wholesale_tenders, wholesale_bids and wholesale_buyers fields). It never contacts a buyer, never sends an alert and
 * never touches Supabase. The one outbound call, when configured, is a read-only GET to the Carbitrage Market API.
 */

export interface WholesaleOptions {
  pool: pg.Pool;
  market: MarketApiConfig | null;
  now: () => Date;
}

export interface WholesaleResponse { status: number; body: unknown }

const DEALER_ID = "00000000-0000-4000-8000-00000000fa01";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

function newCode(): string {
  let out = "WT-";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

interface TestCarRow {
  rego: string; state: string; year: number; make: string; model: string; badge: string; body: string | null; colour: string | null;
  transmission: string | null; vin_masked: string | null; odometer_km: number; notes: string | null; fixture: string;
}

export function createWholesale(opts: WholesaleOptions) {
  const { pool } = opts;

  async function testCar(rego: string): Promise<TestCarRow> {
    const r = await pool.query<TestCarRow>("select * from preview_wholesale_test_cars where rego = $1", [rego.toUpperCase()]);
    if (!r.rows[0]) bad(404, "car_not_found", "No test car with that rego in the preview");
    return r.rows[0];
  }

  function spec(car: TestCarRow, km: number, badge?: string): CarSpec {
    return { year: car.year, make: car.make, model: car.model, badge: badge || car.badge, km, state: car.state, rego: car.rego, fixture: car.fixture };
  }

  async function valuate(car: TestCarRow, km: number, badge?: string): Promise<{ guide: Guide | null; result: ValuationResult; reason: string | null }> {
    const result = await fetchValuation(spec(car, km, badge), opts.market);
    const guide = mapGuide(result.valuation, car.year, opts.now());
    let reason: string | null = null;
    if (!guide) {
      const v = result.valuation;
      reason = v.status === "pending" ? "A live search is running." : v.needs_live_search ? "Not enough fresh ads for this plate year yet." : "No floor yet.";
    }
    return { guide, result, reason };
  }

  async function buyers() {
    const r = await pool.query<{ id: string; contact_name: string; business_name: string }>(
      "select id, contact_name, business_name from wholesale_buyers where approved and active and not is_placeholder order by created_at, contact_name",
    );
    return r.rows.map((b) => ({ id: b.id, name: b.contact_name }));
  }

  async function dealer() {
    const r = await pool.query("select * from preview_wholesale_dealers where id = $1", [DEALER_ID]);
    return r.rows[0] as { id: string; name: string; state: string; person: string; phone: string; email: string; address: string };
  }

  async function latestBids(tenderId: string) {
    const r = await pool.query<{ id: string; buyer_id: string; amount_cents: number; note: string | null; created_at: Date; name: string }>(
      `select distinct on (b.buyer_id) b.id, b.buyer_id, b.amount_cents, b.note, b.created_at, w.contact_name as name
         from wholesale_bids b join wholesale_buyers w on w.id = b.buyer_id
        where b.tender_id = $1 and b.bidder_kind = 'wholesale_buyer'
        order by b.buyer_id, b.created_at desc, b.id`,
      [tenderId],
    );
    return r.rows;
  }

  async function tenderByCode(code: string) {
    const r = await pool.query("select * from wholesale_tenders where public_code = $1 and dealership_id = $2", [code, DEALER_ID]);
    if (!r.rows[0]) bad(404, "not_found", "No such request");
    return r.rows[0];
  }

  function targetIds(tender: { condition: Record<string, unknown> }): string[] | null {
    const t = tender.condition?.target_buyer_ids;
    return Array.isArray(t) ? (t as string[]) : null;
  }

  async function tenderView(tender: Record<string, any>) {
    const all = await buyers();
    const targets = targetIds(tender as { condition: Record<string, unknown> });
    const sentTo = targets ? all.filter((b) => targets.includes(b.id)) : all;
    const bids = await latestBids(tender.id);
    const priced = bids.map((b) => ({ bidId: b.id, buyerId: b.buyer_id, name: b.name, amountCents: b.amount_cents, note: b.note, at: b.created_at.toISOString() }))
      .sort((a, b) => b.amountCents - a.amountCents);
    const pricedIds = new Set(priced.map((p) => p.buyerId));
    return {
      code: tender.public_code,
      status: tender.status as string,
      outcome: tender.outcome as string | null,
      car: { rego: tender.rego, year: tender.year, make: tender.make, model: tender.model, badge: tender.badge, km: tender.km, state: tender.state },
      floorCents: tender.value_car_floor_cents as number | null,
      note: tender.seller_notes as string | null,
      sentTo,
      prices: priced,
      waiting: sentTo.filter((b) => !pricedIds.has(b.id)),
      acceptedBidId: tender.accepted_bid_id as string | null,
      buyerOfRecord: tender.buyer_of_record as string | null,
      finalSaleCents: tender.final_sale_cents as number | null,
      createdAt: tender.created_at.toISOString(),
    };
  }

  async function buyerOf(id: string) {
    const r = await pool.query("select * from wholesale_buyers where id = $1 and approved and active", [id]);
    if (!r.rows[0]) bad(403, "buyer_not_approved", "Not an approved buyer");
    return r.rows[0] as { id: string; contact_name: string; business_name: string; contact_phone: string | null; contact_email: string };
  }

  async function dealerRoute(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<WholesaleResponse | null> {
    if (method === "GET" && path === "/info") {
      const cars = await pool.query<TestCarRow>("select * from preview_wholesale_test_cars order by rego");
      const d = await dealer();
      return { status: 200, body: {
        mode: "preview",
        valuationSource: opts.market ? "market_api" : "recorded",
        dealer: { name: d.name, state: d.state },
        testCars: cars.rows.map((c) => ({ rego: c.rego, label: `${c.year} ${c.make} ${c.model} ${c.badge}`, km: c.odometer_km })),
      } };
    }
    if (method === "GET" && path === "/buyers") return { status: 200, body: { buyers: await buyers() } };

    if (method === "POST" && path === "/lookup") {
      const c = await testCar(str(body, "rego", 12));
      return { status: 200, body: { car: {
        rego: c.rego, state: c.state, year: c.year, make: c.make, model: c.model, badge: c.badge, body: c.body, colour: c.colour,
        transmission: c.transmission, vinMasked: c.vin_masked, odometerKm: c.odometer_km, notes: c.notes,
      } } };
    }

    if (method === "POST" && path === "/guide") {
      const c = await testCar(str(body, "rego", 12));
      const km = int(body, "km", 0, 2_000_000);
      const badge = typeof body.badge === "string" && body.badge.trim() ? body.badge.trim().slice(0, 60) : undefined;
      const { guide, result, reason } = await valuate(c, km, badge);
      // A held car is remembered so the dealer's Updates list can say so. It clears the moment a floor exists.
      if (guide) await pool.query("update preview_wholesale_held set cleared_at = now() where dealership_id=$1 and rego=$2 and cleared_at is null", [DEALER_ID, c.rego]);
      else {
        const open = await pool.query("update preview_wholesale_held set km=$3, badge=$4, reason=$5 where dealership_id=$1 and rego=$2 and cleared_at is null", [DEALER_ID, c.rego, km, badge ?? c.badge, reason]);
        if (!open.rowCount) await pool.query("insert into preview_wholesale_held (dealership_id, rego, km, badge, reason) values ($1,$2,$3,$4,$5)", [DEALER_ID, c.rego, km, badge ?? c.badge, reason]);
      }
      return { status: 200, body: {
        held: guide === null, reason, guide, source: result.source, engine: result.valuation.engine ?? null, route: result.valuation.route ?? null,
        freshExactYearAds: result.valuation.n_exact_year ?? null,
        car: { rego: c.rego, state: c.state, year: c.year, make: c.make, model: c.model, badge: badge || c.badge, km, notes: c.notes },
      } };
    }

    if (method === "POST" && path === "/send") {
      const c = await testCar(str(body, "rego", 12));
      const km = int(body, "km", 0, 2_000_000);
      const badge = typeof body.badge === "string" && body.badge.trim() ? body.badge.trim().slice(0, 60) : c.badge;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 600) : "";
      const approved = await buyers();
      const wanted = body.buyerIds === "all" ? approved.map((b) => b.id) : Array.isArray(body.buyerIds) ? (body.buyerIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const targets = approved.filter((b) => wanted.includes(b.id)).map((b) => b.id);
      if (targets.length === 0) bad(400, "no_buyers", "Pick at least one approved buyer");
      // The floor is always recomputed here. Nothing a browser sends can set it.
      const { guide, reason } = await valuate(c, km, badge);
      if (!guide) {
        return { status: 409, body: { code: "floor_held", message: "Held. Nothing was sent, because there is no floor yet.", reason } };
      }
      const d = await dealer();
      const all = targets.length === approved.length;
      const code = newCode();
      const cents = guide.floor_dollars * 100;
      const inserted = await pool.query(
        `insert into wholesale_tenders
           (dealership_id, public_code, status, rego, year, make, model, badge, km, colour, state, condition, seller_notes,
            opens_at, retail_floor_cents, value_car_floor_cents, value_car_snapshot)
         values ($1,$2,'live',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12, now(), $13,$13,$14::jsonb)
         returning public_code`,
        [DEALER_ID, code, c.rego, c.year, c.make, c.model, badge, km, c.colour, d.state,
          JSON.stringify({ franchise: true, ...(all ? {} : { target_buyer_ids: targets }) }), note || null, cents, JSON.stringify(guide)],
      );
      return { status: 201, body: { code: inserted.rows[0].public_code, sentTo: targets.length } };
    }

    if (method === "GET" && path === "/requests") {
      const r = await pool.query("select * from wholesale_tenders where dealership_id = $1 order by created_at desc", [DEALER_ID]);
      return { status: 200, body: { requests: await Promise.all(r.rows.map(tenderView)) } };
    }

    const m = path.match(/^\/requests\/(WT-[A-Z0-9]{6})(?:\/(pick|keep|collected))?$/);
    if (m) {
      const tender = await tenderByCode(m[1]);
      if (method === "GET" && !m[2]) {
        const view = await tenderView(tender);
        const guide = tender.value_car_snapshot as Guide | null;
        const accepted = tender.accepted_bid_id
          ? (await pool.query("select b.amount_cents, w.* from wholesale_bids b join wholesale_buyers w on w.id = b.buyer_id where b.id = $1", [tender.accepted_bid_id])).rows[0]
          : null;
        const d = await dealer();
        return { status: 200, body: {
          ...view, guide,
          buyer: accepted ? { business: accepted.business_name, person: accepted.contact_name, phone: accepted.contact_phone, email: accepted.contact_email } : null,
          dealer: { business: d.name, person: d.person, phone: d.phone, email: d.email, address: d.address },
        } };
      }
      if (method === "POST" && m[2] === "pick") {
        if (tender.status !== "live") bad(409, "not_open", "This request is no longer open");
        const bidId = str(body, "bidId", 64);
        const bids = await latestBids(tender.id);
        const chosen = bids.find((b) => b.id === bidId);
        if (!chosen) bad(404, "bid_not_found", "That is not a current price on this car");
        const buyer = await buyerOf(chosen.buyer_id);
        const best = Math.max(...bids.map((b) => b.amount_cents));
        await pool.query(
          `update wholesale_tenders set status='accepted', accepted_bid_id=$2, buyer_of_record=$3, best_bid_cents=$4, final_sale_cents=$5, updated_at=now() where id=$1 and status='live'`,
          [tender.id, chosen.id, buyer.business_name, best, chosen.amount_cents],
        );
        return { status: 200, body: { ok: true, code: tender.public_code } };
      }
      if (method === "POST" && m[2] === "keep") {
        if (tender.status !== "live") bad(409, "not_open", "This request is no longer open");
        await pool.query("update wholesale_tenders set status='declined', updated_at=now() where id=$1", [tender.id]);
        return { status: 200, body: { ok: true } };
      }
      if (method === "POST" && m[2] === "collected") {
        if (tender.status !== "accepted") bad(409, "not_picked", "Pick a price first");
        await pool.query("update wholesale_tenders set outcome='completed', sold_at=now(), sold_cents=final_sale_cents, sold_channel='wholesale', updated_at=now() where id=$1", [tender.id]);
        return { status: 200, body: { ok: true } };
      }
    }

    if (method === "GET" && path === "/updates") {
      const rows = await pool.query("select * from wholesale_tenders where dealership_id = $1 order by created_at desc", [DEALER_ID]);
      const held = await pool.query("select h.*, t.year, t.make, t.model, t.badge as tbadge from preview_wholesale_held h join preview_wholesale_test_cars t on t.rego = h.rego where h.dealership_id = $1 and h.cleared_at is null order by h.created_at desc", [DEALER_ID]);
      const events: Array<{ at: string; rego: string; car: string; status: string; text: string }> = [];
      for (const h of held.rows) {
        events.push({ at: h.created_at.toISOString(), rego: h.rego, car: `${h.year} ${h.model} ${h.tbadge}`, status: "held", text: "Held, no floor yet." });
      }
      for (const t of rows.rows) {
        const v = await tenderView(t);
        const car = `${t.year} ${t.model} ${t.badge}`;
        events.push({ at: t.created_at.toISOString(), rego: t.rego, car, status: "waiting", text: `Sent to ${v.sentTo.length} buyer${v.sentTo.length === 1 ? "" : "s"}.` });
        if (v.prices.length) {
          const last = v.prices.reduce((a, b) => (a.at > b.at ? a : b));
          events.push({ at: last.at, rego: t.rego, car, status: "prices", text: `${v.prices.length} price${v.prices.length === 1 ? "" : "s"} in. Best $${Math.round(v.prices[0].amountCents / 100).toLocaleString("en-AU")}.` });
        }
        if (t.status === "accepted") events.push({ at: t.updated_at.toISOString(), rego: t.rego, car, status: t.outcome === "completed" ? "handover" : "picked", text: t.outcome === "completed" ? `Sold to ${v.prices.find((p) => p.bidId === t.accepted_bid_id)?.name ?? "the buyer"} for $${Math.round((t.final_sale_cents ?? 0) / 100).toLocaleString("en-AU")}.` : `You picked ${v.prices.find((p) => p.bidId === t.accepted_bid_id)?.name ?? "a buyer"} at $${Math.round((t.final_sale_cents ?? 0) / 100).toLocaleString("en-AU")}.` });
        if (t.status === "declined") events.push({ at: t.updated_at.toISOString(), rego: t.rego, car, status: "picked", text: "You kept the car." });
      }
      events.sort((a, b) => b.at.localeCompare(a.at));
      return { status: 200, body: { updates: events } };
    }
    return null;
  }

  /** Buyer side. In the preview a buyer is chosen with ?as=<buyer id>. Production would use the buyer's own sign-in. */
  async function buyerRoute(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<WholesaleResponse | null> {
    if (method === "GET" && path === "/buyer/list") return { status: 200, body: { buyers: await buyers() } };
    const asId = (method === "GET" ? query.get("as") : typeof body.as === "string" ? body.as : null) ?? "";
    if (!asId) bad(400, "invalid_payload", "as is required in the preview");
    const buyer = await buyerOf(asId);

    if (method === "GET" && path === "/buyer/cars") {
      const r = await pool.query("select * from wholesale_tenders where status in ('live','accepted','declined') order by created_at desc");
      const cars = [];
      for (const t of r.rows) {
        const targets = targetIds(t);
        if (targets && !targets.includes(buyer.id)) continue;
        const mine = await pool.query("select amount_cents from wholesale_bids where tender_id=$1 and buyer_id=$2 order by created_at desc limit 1", [t.id, buyer.id]);
        if (t.status !== "live" && !mine.rows[0]) continue;
        const guide = t.value_car_snapshot as Guide | null;
        const franchise = Boolean(t.condition?.franchise);
        cars.push({
          code: t.public_code, year: t.year, make: t.make, model: t.model, badge: t.badge, km: t.km,
          sellerLabel: `${franchise ? "Franchise dealer" : "Used car yard"}, ${t.state}`, franchise, state: t.state,
          note: t.seller_notes, // the dealer's note only. No dealer name, rego, VIN or contact is ever returned here.
          guide: guide ? { ...guide, outlier_ads: [] } : null,
          myPriceCents: mine.rows[0]?.amount_cents ?? null,
          locked: t.status !== "live",
        });
      }
      return { status: 200, body: { buyer: { id: buyer.id, name: buyer.contact_name }, cars } };
    }

    if (method === "POST" && path === "/buyer/price") {
      const code = str(body, "code", 12);
      const cents = int(body, "amountDollars", 100, 2_000_000) * 100;
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
      const t = (await pool.query("select * from wholesale_tenders where public_code=$1", [code])).rows[0];
      if (!t) bad(404, "not_found", "No such car");
      const targets = targetIds(t);
      if (targets && !targets.includes(buyer.id)) bad(404, "not_found", "No such car");
      if (t.status !== "live") bad(409, "locked", "Price locked, the dealer has already picked");
      // Every price is a new row. Nothing is overwritten, so the buyer's history keeps the whole trail.
      await pool.query("insert into wholesale_bids (tender_id, bidder_kind, buyer_id, amount_cents, kind, note) values ($1,'wholesale_buyer',$2,$3,'offer',$4)", [t.id, buyer.id, cents, note]);
      return { status: 201, body: { ok: true } };
    }

    if (method === "GET" && path === "/buyer/history") {
      const r = await pool.query(
        `select t.*, (select json_agg(json_build_object('amount', b.amount_cents/100, 'at', b.created_at, 'note', b.note) order by b.created_at)
                        from wholesale_bids b where b.tender_id = t.id and b.buyer_id = $1) as events
           from wholesale_tenders t where exists (select 1 from wholesale_bids b where b.tender_id = t.id and b.buyer_id = $1) order by t.created_at desc`,
        [buyer.id],
      );
      const out = [];
      for (const t of r.rows) {
        const franchise = Boolean(t.condition?.franchise);
        let o: "open" | "picked" | "not_picked" | "dealer_kept" = t.status === "declined" ? "dealer_kept" : "open";
        if (t.status === "accepted") {
          const won = await pool.query("select 1 from wholesale_bids where id=$1 and buyer_id=$2", [t.accepted_bid_id, buyer.id]);
          o = won.rowCount ? "picked" : "not_picked";
        }
        out.push({
          ref: t.public_code, year: t.year, make: t.make, model: t.model, badge: t.badge, km: t.km, state: t.state,
          sellerLabel: `${franchise ? "Franchise dealer" : "Used car yard"}, ${t.state}`, franchise,
          events: t.events, outcome: o, outcomeAt: o === "open" ? null : t.updated_at,
        });
      }
      return { status: 200, body: { rows: out } };
    }
    return null;
  }

  return {
    async handle(side: "dealer" | "buyer", method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<WholesaleResponse> {
      const found = side === "buyer" ? await buyerRoute(method, path, query, body) : await dealerRoute(method, path, query, body);
      if (!found) bad(404, "not_found", "No such wholesale route");
      return found;
    },
  };
}

export type Wholesale = ReturnType<typeof createWholesale>;
