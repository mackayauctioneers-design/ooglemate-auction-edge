import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fetchValuation, fromApiValuation, mapGuide, type EngineValuation } from "./wholesale-guide.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const NOW = new Date("2026-11-20T01:10:25.000Z");

test("guide mapping reproduces the guide stored on the Macan tender (same mapping as before)", () => {
  const engine = load("wholesale-macan-recorded-20261120.json") as EngineValuation;
  const expected = load("wholesale-macan-expected-guide.json");
  const guide = mapGuide(engine, 2022, NOW);
  assert.ok(guide);
  for (const key of ["version", "floor_car", "floor_dollars", "buy_target", "max_buy", "thinking", "cautious", "confidence", "provisional", "thin_evidence", "state", "comps", "generated_at", "floor_basis", "year_below"]) {
    assert.deepEqual((guide as unknown as Record<string, unknown>)[key], expected[key], key);
  }
});

test("the year-below car is reference only and never in the comps", () => {
  const guide = mapGuide(load("wholesale-rav4-sample.json"), 2021, NOW);
  assert.ok(guide);
  assert.equal(guide.year_below?.year, 2020);
  assert.ok(guide.comps.every((c) => c.year === 2021));
  assert.equal(guide.outlier_ads.length, 1);
  assert.ok(guide.outlier_ads[0].price_ex_gov < guide.floor_dollars);
});

test("no floor means no guide, so nothing can be sent", () => {
  assert.equal(mapGuide(load("wholesale-captiva-held.json"), 2016, NOW), null);
  assert.equal(mapGuide({ status: "pending", job_id: "abc12345" } as EngineValuation, 2016, NOW), null);
});

test("the live API answer after the engine fixes (Macan, 20 Nov 12:47)", () => {
  const guide = mapGuide(fromApiValuation(load("wholesale-macan-api-post-shaz-fix-20261120.json")), 2022, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_dollars, 74990);
  assert.equal(guide.thinking, 63900);
  assert.equal(guide.cautious, 62900);
  assert.equal(guide.floor_basis, "exact_year");
  assert.equal(guide.year_below?.year, 2021);
  assert.equal(guide.year_below?.price_ex_gov, 57990); // reference only
  assert.ok(guide.comps.length > 0 && guide.comps.every((c) => c.year === 2022 && c.link !== guide.floor_car.link));
});

test("RAV4 2021: floor from the 2020 car, said plainly, year-below not repeated", () => {
  const guide = mapGuide(fromApiValuation(load("wholesale-rav4-api-pending-20261120.json")), 2021, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_dollars, 36090);
  assert.equal(guide.floor_car.year, 2020);
  assert.equal(guide.thinking, 28900);
  assert.equal(guide.cautious, 27900);
  assert.equal(guide.floor_basis, "year_below_fallback");
  assert.match(guide.floor_basis_note ?? "", /plate year below/);
  assert.equal(guide.year_below, null);
});

test("pool answer first, then the live check is polled no faster than asked and replaces it when final", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wg-"));
  const keyFile = join(dir, "key"); const cacheFile = join(dir, "cache.json");
  writeFileSync(keyFile, "test-key-not-real");
  const pool = load("wholesale-rav4-api-pending-20261120.json");
  const pending = load("wholesale-rav4-poll-pending-20261120.json");
  const done = { ...load("wholesale-macan-api-post-shaz-fix-20261120.json"), route: "live_cached" };
  const calls: string[] = [];
  let phase: "pending" | "done" = "pending";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).replace(/^https:\/\/[^/]+/, ""));
    const body = String(url).includes("/live/") ? (phase === "pending" ? pending : done) : pool;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    const cfg = { baseUrl: "https://engine.example.invalid", keyFile, cacheFile };
    const car = { year: 2021, make: "Toyota", model: "RAV4", badge: "GX Hybrid 2WD", km: 58400, state: "NSW", fixture: "rav4-sample" };
    const first = await fetchValuation(car, cfg);
    assert.equal(first.source, "market_api");
    assert.equal(first.livePending?.jobId, "ls_9ba2e53b497f");
    assert.equal(first.valuation.floor_car?.price_ex_gov, 36090); // the pool answer is shown straight away
    assert.equal(calls.length, 1);
    // asked again at once: no new calls, still checking
    const again = await fetchValuation(car, cfg);
    assert.ok(again.livePending);
    assert.equal(calls.length, 1);
    // after the wait it polls once, still pending
    t += 25_000;
    const second = await fetchValuation(car, cfg);
    assert.ok(second.livePending);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /^\/api\/v1\/valuation\/live\/ls_9ba2e53b497f$/);
    // too soon again: no call
    t += 5_000;
    await fetchValuation(car, cfg);
    assert.equal(calls.length, 2);
    // final answer replaces the pool answer
    phase = "done"; t += 30_000;
    const final = await fetchValuation(car, cfg);
    assert.equal(final.livePending, null);
    assert.equal(final.route, "live_cached");
    assert.equal(calls.length, 3);
    t += 60_000;
    await fetchValuation(car, cfg);
    assert.equal(calls.length, 3); // final answers are cached, no more polling
  } finally {
    globalThis.fetch = realFetch; Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});
