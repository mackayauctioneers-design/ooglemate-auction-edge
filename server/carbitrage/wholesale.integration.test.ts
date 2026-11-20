import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";
import { applyWholesaleMirror } from "./pg-port.ts";
import { createWholesale } from "./wholesale.ts";

/**
 * Runs the two pending production migrations (supabase/pending/) on a throwaway local database, through the same
 * mirror the private preview uses, and checks dealer scoping, buyer scoping, the OFF alert switch, the targeted-buyer
 * column, backwards compatibility and the undo files. Skipped when the box's local Postgres is not reachable.
 */

const DEALER = "00000000-0000-4000-8000-0000000d0001";
const BUYER = (n: number) => `00000000-0000-4000-8000-0000000b0a0${n}`;
const BUYER_ID = (n: number) => `00000000-0000-4000-8000-00000000b00${n}`;
const OUTSIDER = "11111111-1111-4111-8111-111111111111";

let base: string | null = null;
try { base = readFileSync(".carbitrage-local/migrate-url", "utf8").trim(); } catch { base = null; }
const dbName = `wholesale_it_${process.pid}_${randomBytes(3).toString("hex")}`;
let url = "";
let admin: pg.Client;
let pool: pg.Pool;
let ws: ReturnType<typeof createWholesale>;
let ok = false;

before(async () => {
  if (!base) return;
  const adminUrl = new URL(base);
  admin = new pg.Client({ connectionString: base });
  try { await admin.connect(); } catch { return; }
  await admin.query(`create database ${dbName}`);
  const u = new URL(base); u.pathname = `/${dbName}`; url = u.toString();
  await applyWholesaleMirror(url);
  pool = new pg.Pool({ connectionString: url, max: 3 });
  ws = createWholesale({ pool, market: null, now: () => new Date("2026-11-20T12:00:00Z"), preview: true, picker: true });
  ok = true;
  void adminUrl;
});

after(async () => {
  if (pool) await pool.end();
  if (admin && ok) { await admin.query(`drop database if exists ${dbName} with (force)`); }
  if (admin) await admin.end().catch(() => undefined);
});

const q = (sql: string, args: unknown[] = []) => pool.query(sql, args);
const call = (side: "dealer" | "buyer", user: string | null, method: string, path: string, body: Record<string, unknown> = {}, qs = "") =>
  ws.handle(side, user, method, path, new URLSearchParams(qs), body);
async function status(p: Promise<{ status: number }>): Promise<number> {
  try { return (await p).status; } catch (e) { return (e as { status?: number }).status ?? 500; }
}

test("migrations create the switch OFF and keep old behaviour", { skip: !base }, async (t) => {
  if (!ok) return t.skip("local Postgres not reachable");
  const sw = await q("select enabled from carbitrage_switches where key = 'franchise_buyer_alerts'");
  assert.equal(sw.rows[0].enabled, false);
  // an ordinary (non-franchise) request still alerts every approved buyer, switch off
  await q(`insert into wholesale_tenders (dealership_id, public_code, status, year, make, model, state, value_car_floor_cents)
           values ('00000000-0000-4000-8000-00000000fa01', 'WT-OLD001', 'live', 2020, 'X', 'Y', 'NSW', 1000000)`);
  const a = await q("select count(*)::int n from wholesale_buyer_alerts where tender_id = (select id from wholesale_tenders where public_code = 'WT-OLD001')");
  assert.equal(a.rows[0].n, 4);
  await q("delete from wholesale_buyer_alerts; delete from wholesale_tenders where public_code = 'WT-OLD001'");
});

test("a franchise send with the switch OFF queues no alerts and no due row", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const sent = await call("dealer", DEALER, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: "all", note: "Two keys" });
  assert.equal(sent.status, 201);
  assert.equal((await q("select count(*)::int n from wholesale_buyer_alerts")).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from wholesale_notification_log")).rows[0].n, 0);
  const row = (await q("select franchise_car, target_buyer_ids, status from wholesale_tenders")).rows[0];
  assert.equal(row.franchise_car, true);
  assert.equal(row.target_buyer_ids, null); // all four = NULL
});

test("held car: nothing is sent without a floor", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const before = (await q("select count(*)::int n from wholesale_tenders")).rows[0].n;
  assert.equal(await status(call("dealer", DEALER, "POST", "/send", { rego: "TEST03", km: 141200, buyerIds: "all" })), 409);
  assert.equal((await q("select count(*)::int n from wholesale_tenders")).rows[0].n, before);
  // even a direct call with no floor is refused by the database
  await assert.rejects(q("select public.carbitrage_wholesale_send_v1($1, '{\"year\":2016,\"make\":\"a\",\"model\":\"b\",\"badge\":\"c\",\"km\":1,\"state\":\"NSW\"}'::jsonb, null, null, '{}'::jsonb)", [DEALER]), /floor_required/);
});

test("dealer scoping: only a wholesale dealer member can act", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  assert.equal(await status(call("dealer", OUTSIDER, "GET", "/requests")), 403);
  assert.equal(await status(call("dealer", OUTSIDER, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: "all" })), 403);
  assert.equal(await status(call("dealer", null, "GET", "/requests")), 401);
  // a buyer's sign-in is not a dealer
  assert.equal(await status(call("dealer", BUYER(1), "GET", "/requests")), 403);
  // a member of a dealership with only the ordinary wholesale_pricing feature (an Ooglecars yard) is not a franchise dealer
  await q("insert into dealerships (id, name, slug) values ('22222222-2222-4222-8222-222222222222', 'Other', 'other')");
  await q("insert into dealership_features (dealership_id, feature_key, enabled) values ('22222222-2222-4222-8222-222222222222', 'wholesale_pricing', true)");
  await q("insert into dealership_members (dealership_id, user_id) values ('22222222-2222-4222-8222-222222222222', $1)", [OUTSIDER]);
  assert.equal(await status(call("dealer", OUTSIDER, "GET", "/requests")), 403);
  const mine = (await call("dealer", DEALER, "GET", "/requests")).body as { requests: unknown[] };
  assert.equal(mine.requests.length, 1);
});

test("alerts ON: targeted buyers only, stable due row, then OFF again", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  await q("update carbitrage_switches set enabled = true where key = 'franchise_buyer_alerts'");
  const sent = await call("dealer", DEALER, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: [BUYER_ID(1), BUYER_ID(3)] });
  assert.equal(sent.status, 201);
  const code = (sent.body as { code: string }).code;
  const t2 = (await q("select id, dealership_id, target_buyer_ids from wholesale_tenders where public_code = $1", [code])).rows[0];
  assert.deepEqual([...t2.target_buyer_ids].sort(), [BUYER_ID(1), BUYER_ID(3)]);
  const alerts = await q("select buyer_id from wholesale_buyer_alerts where tender_id = $1 order by 1", [t2.id]);
  assert.deepEqual(alerts.rows.map((r) => r.buyer_id), [BUYER_ID(1), BUYER_ID(3)]);
  const due = (await q("select id, kind, body from wholesale_notification_log where tender_id = $1 and kind = 'buyer_alerts_due'", [t2.id])).rows;
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "buyer_alerts_due");
  assert.equal(due[0].body, "pending");
  // same id the Ooglecars app computes
  const hex = createHash("sha256").update(`wholesale-alerts-due:${t2.dealership_id}:tender:${t2.id}`).digest("hex");
  assert.equal(due[0].id, `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`);
  // the preview's stand-in alert worker wrote one test-inbox message per picked buyer, and no one else
  const bots = (await q("select buyer_id, body from wholesale_notification_log where tender_id = $1 and kind = 'buyer_bot_alert' order by buyer_id", [t2.id])).rows;
  assert.deepEqual(bots.map((r) => r.buyer_id), [BUYER_ID(1), BUYER_ID(3)]);
  for (const b of bots) assert.ok(!/preview test dealer|dealer\.example|patrick/i.test(b.body), "alert named the dealer");
  await q("update carbitrage_switches set enabled = false where key = 'franchise_buyer_alerts'");
  (globalThis as { __code?: string }).__code = code;
});

test("buyer scoping, one price per buyer with history, lock on pick", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const code = (globalThis as { __code?: string }).__code!;
  // buyer 2 was not picked for this car: sees only the all-buyers car, cannot price the targeted one
  const cars2 = (await call("buyer", BUYER(2), "GET", "/buyer/cars")).body as { cars: Array<{ code: string }> };
  assert.ok(!cars2.cars.some((c) => c.code === code));
  assert.equal(await status(call("buyer", BUYER(2), "POST", "/buyer/price", { code, amountDollars: 30000 })), 404);
  const cars1 = (await call("buyer", BUYER(1), "GET", "/buyer/cars")).body as { cars: Array<Record<string, unknown>> };
  const mine = cars1.cars.find((c) => c.code === code)!;
  assert.ok(mine);
  const leaked = JSON.stringify(cars1);
  for (const needle of ["Preview Test Dealer", "dealer.example", "dealership", "TEST02", "vin", "00000000-0000-4000-8000-00000000fa01"]) {
    assert.ok(!leaked.toLowerCase().includes(needle.toLowerCase()), `buyer view leaked ${needle}`);
  }
  assert.equal(mine.sellerLabel, "Franchise dealer, NSW");
  assert.equal((await call("buyer", BUYER(1), "POST", "/buyer/price", { code, amountDollars: 28000 })).status, 201);
  assert.equal((await call("buyer", BUYER(1), "POST", "/buyer/price", { code, amountDollars: 29000, note: "up" })).status, 201);
  assert.equal((await q("select count(*)::int n from wholesale_bids b join wholesale_tenders t on t.id=b.tender_id where t.public_code=$1 and b.buyer_id=$2", [code, BUYER_ID(1)])).rows[0].n, 1);
  const hist = (await call("buyer", BUYER(1), "GET", "/buyer/history")).body as { rows: Array<{ ref: string; events: Array<{ amount: number }> }> };
  assert.deepEqual(hist.rows.find((r) => r.ref === code)!.events.map((e) => e.amount), [28000, 29000]);
  assert.equal(await status(call("buyer", BUYER(1), "POST", "/buyer/price", { code, amountDollars: 0 })), 400);
  // a sign-in that is not a buyer
  assert.equal(await status(call("buyer", OUTSIDER, "GET", "/buyer/cars")), 403);
  assert.equal(await status(call("buyer", DEALER, "GET", "/buyer/cars")), 403);
  // an unapproved buyer is refused
  await q("update wholesale_buyers set status = 'pending' where id = $1", [BUYER_ID(3)]);
  assert.equal(await status(call("buyer", BUYER(3), "GET", "/buyer/cars")), 403);
  await q("update wholesale_buyers set status = 'approved' where id = $1", [BUYER_ID(3)]);
  // dealer picks buyer 1's price; the price then locks
  const detail = (await call("dealer", DEALER, "GET", `/requests/${code}`)).body as { prices: Array<{ bidId: string }>; buyer: unknown };
  assert.equal(detail.prices.length, 1);
  assert.equal(await status(call("dealer", OUTSIDER, "POST", `/requests/${code}/pick`, { bidId: detail.prices[0].bidId })), 403);
  assert.equal((await call("dealer", DEALER, "POST", `/requests/${code}/pick`, { bidId: detail.prices[0].bidId })).status, 200);
  assert.equal(await status(call("buyer", BUYER(1), "POST", "/buyer/price", { code, amountDollars: 31000 })), 409);
  const after = (await call("dealer", DEALER, "GET", `/requests/${code}`)).body as { buyer: { business: string } | null; finalSaleCents: number };
  assert.equal(after.finalSaleCents, 2_900_000);
  assert.ok(after.buyer?.business);
  assert.equal((await call("dealer", DEALER, "POST", `/requests/${code}/collected`)).status, 200);
});

test("preview picker is refused outside preview", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const live = createWholesale({ pool, market: null, now: () => new Date(), preview: false });
  await assert.rejects(live.handle("buyer", null, "GET", "/buyer/cars", new URLSearchParams(`as=${BUYER_ID(1)}`), {}), (e: { status?: number }) => e.status === 401);
  await assert.rejects(live.handle("buyer", null, "GET", "/buyer/list", new URLSearchParams(), {}), (e: { status?: number }) => e.status === 404);
  // no recorded fixtures outside preview, and no engine configured here: the car is held, never sent
  const r = await live.handle("dealer", DEALER, "POST", "/send", new URLSearchParams(), { year: 2022, make: "Toyota", model: "RAV4", badge: "GX", km: 1000, state: "NSW", buyerIds: "all" });
  assert.equal(r.status, 409);
});

test("undo files put everything back (and refuse while franchise requests exist)", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const sql = (n: string) => readFileSync(new URL(`../../supabase/pending/${n}`, import.meta.url), "utf8");
  await q(sql("carbitrage-wholesale-0004-franchise-alert-message.undo.sql"));
  assert.equal((await q("select count(*)::int n from pg_proc where proname = 'carbitrage_wholesale_alert_message_v1'")).rows[0].n, 0);
  await q(sql("carbitrage-wholesale-0003-franchise-feature.undo.sql"));
  assert.match((await q("select pg_get_functiondef('public.carbitrage_wholesale_dealership_v1(uuid)'::regprocedure) d")).rows[0].d, /wholesale_pricing/);
  await q(sql("carbitrage-wholesale-0002-rpc-v1.undo.sql"));
  assert.equal((await q("select count(*)::int n from pg_proc where proname like 'carbitrage_wholesale_%'")).rows[0].n, 0);
  await assert.rejects(q(sql("carbitrage-wholesale-0001-franchise-columns.undo.sql")), /franchise or targeted requests exist/);
  await q("delete from wholesale_bid_events; delete from wholesale_bids; delete from wholesale_buyer_alerts; delete from wholesale_notification_log; delete from wholesale_tenders");
  await q(sql("carbitrage-wholesale-0001-franchise-columns.undo.sql"));
  const cols = await q("select column_name from information_schema.columns where table_name = 'wholesale_tenders' and column_name in ('target_buyer_ids','franchise_car')");
  assert.equal(cols.rowCount, 0);
  assert.equal((await q("select to_regclass('public.carbitrage_switches') as t")).rows[0].t, null);
  // old trigger text restored: an insert alerts every approved buyer again
  await q(`insert into wholesale_tenders (dealership_id, public_code, status, year, make, model, state, value_car_floor_cents)
           values ('00000000-0000-4000-8000-00000000fa01', 'WT-OLD002', 'live', 2020, 'X', 'Y', 'NSW', 1000000)`);
  assert.equal((await q("select count(*)::int n from wholesale_buyer_alerts")).rows[0].n, 4);
  // and the migrations apply cleanly again after an undo
  await q("delete from wholesale_buyer_alerts; delete from wholesale_tenders");
  await q(sql("carbitrage-wholesale-0001-franchise-columns.sql"));
  await q(sql("carbitrage-wholesale-0002-rpc-v1.sql"));
  await q(sql("carbitrage-wholesale-0003-franchise-feature.sql"));
  await q(sql("carbitrage-wholesale-0004-franchise-alert-message.sql"));
  assert.equal((await q("select enabled from carbitrage_switches")).rows[0].enabled, false);
});
