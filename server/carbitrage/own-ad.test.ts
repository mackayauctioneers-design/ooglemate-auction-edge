import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { excludeOwnAds, fetchValuation, mapGuide, type EngineValuation } from "./wholesale-guide.ts";

const NOW = new Date("2026-11-20T01:10:25.000Z");
const OWN = "https://example.invalid/ads/round-60k";
const NEXT = "https://example.invalid/ads/next";

function engine(over: Partial<EngineValuation> = {}): EngineValuation {
  return {
    status: "ok",
    floor_basis: "exact_year",
    buy_target: 29600,
    max_buy: 30600,
    confidence: { score: 70, label: "medium", dealer: "Example Motors" } as EngineValuation["confidence"],
    floor_car: { title: "2021 Toyota RAV4", year: 2021, km: 60_000, price_ex_gov: 35_200, link: OWN, seller: "Example Motors" } as EngineValuation["floor_car"],
    comps: [
      { title: "2021 Toyota RAV4", year: 2021, km: 60_000, price_ex_gov: 35_200, link: OWN },
      { title: "2021 Toyota RAV4", year: 2021, km: 61_300, price_ex_gov: 35_990, link: NEXT },
    ],
    year_below: {
      price_ex_gov: 32_990, year: 2020, km: 63_800, link: "https://example.invalid/ads/2020", source: "Carbitrage", note: "reference only",
      seller: "Example Motors", phone: "0400 000 000", stock: "OC0123",
    } as EngineValuation["year_below"],
    outlier_ads: [{ price_ex_gov: 29_490, year: 2021, km: 64_100, link: "https://example.invalid/ads/outlier", note: "check it", seller: "Example Motors" } as never],
    ...over,
  };
}

test("a round 60,000 km advert is dropped when the price is close, and the next comp becomes the floor", () => {
  // 59,840 is 160 km from the printed 60,000. The market engine's own guard skips that round reading.
  const guide = mapGuide(excludeOwnAds(engine(), 59_840, { price: 35_200 }), 2021, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_car.link, NEXT);
  assert.equal(guide.floor_dollars, 35_990);
  assert.equal(guide.floor_basis, "exact_year");
  assert.ok(guide.comps.every((c) => c.link !== OWN));
  const stored = JSON.stringify(guide);
  assert.equal(stored.includes("round-60k"), false);
  assert.equal(stored.includes("Example Motors"), false);
  assert.equal(stored.includes("0400 000 000"), false);
  assert.equal(stored.includes("OC0123"), false);
});

test("the same round kilometre is dropped when it is only a comp", () => {
  const guide = mapGuide(excludeOwnAds(engine({
    floor_car: { title: "2021 Toyota RAV4", year: 2021, km: 61_300, price_ex_gov: 35_990, link: NEXT },
  }), 59_840, { price: 35_200 }), 2021, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_car.link, NEXT);
  assert.equal(guide.floor_dollars, 35_990);
  assert.ok(guide.comps.every((c) => c.link !== OWN));
});

test("a link match drops the advert even when the kilometres are nowhere near", () => {
  const guide = mapGuide(excludeOwnAds(engine(), 10_000, { link: "https://www.example.invalid/ads/round-60k?utm=buyer" }), 2021, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_car.link, NEXT);
  assert.equal(JSON.stringify(guide).includes(OWN), false);
});

test("price without the kilometres, or kilometres without the price, leaves the advert in", () => {
  const farKm = mapGuide(excludeOwnAds(engine(), 80_000, { price: 35_200 }), 2021, NOW);
  assert.equal(farKm?.floor_car.link, OWN);
  const farPrice = mapGuide(excludeOwnAds(engine(), 59_840, { price: 50_000 }), 2021, NOW);
  assert.equal(farPrice?.floor_car.link, OWN);
  // 61,000 is 1,000 km from 60,000, outside the 500 km window.
  const outside = mapGuide(excludeOwnAds(engine(), 61_000, { price: 35_200 }), 2021, NOW);
  assert.equal(outside?.floor_car.link, OWN);
});

test("no comp left of that year means no guide, so nothing can be sent", () => {
  const only = engine({ comps: [{ title: "2021 Toyota RAV4", year: 2021, km: 60_000, price_ex_gov: 35_200, link: OWN }] });
  assert.equal(mapGuide(excludeOwnAds(only, 60_000, { price: 35_200 }), 2021, NOW), null);
});

test("buyer-facing year-below, confidence, floor and outliers keep only their own fields", () => {
  const guide = mapGuide(engine({
    floor_car: { title: "2021 Toyota RAV4", year: 2021, km: 61_300, price_ex_gov: 35_990, link: NEXT },
    comps: [{ title: "2021 Toyota RAV4", year: 2021, km: 70_100, price_ex_gov: 36_450, link: "https://example.invalid/ads/other", note: "secret yard" } as never],
  }), 2021, NOW);
  assert.ok(guide);
  assert.deepEqual(Object.keys(guide.year_below ?? {}).sort(), ["km", "link", "note", "price_ex_gov", "source", "year"]);
  assert.deepEqual(guide.confidence, { score: 70, label: "medium" });
  assert.equal("seller" in (guide.floor_car as object), false);
  assert.equal(guide.outlier_ads[0] && "seller" in guide.outlier_ads[0], false);
  assert.equal(JSON.stringify(guide.comps).includes("secret yard"), false);
  assert.equal("own_ad_excluded" in (guide as object), false);
});

test("the live valuation is asked to leave out the dealer's own ad", async () => {
  const dir = mkdtempSync(join(tmpdir(), "own-ad-"));
  const keyFile = join(dir, "key");
  writeFileSync(keyFile, "test-key-not-real");
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      status: "ok", floor: 35_990, route: "db_instant", final: true, confidence: "low",
      floor_car: { title: "2021 Toyota RAV4", year: 2021, km: 61_300, price_ex_gov: 35_990, url: NEXT },
      floor_comps: [], buying_view: { thinking: 30_000, cautious: 29_000 },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    await fetchValuation(
      { year: 2021, make: "Toyota", model: "RAV4", badge: "OwnAdProbe", km: 59_840, state: "NSW", fixture: "rav4-sample" },
      { baseUrl: "https://engine.example.invalid", keyFile, cacheFile: join(dir, "cache.json") },
      { link: "https://example.invalid/ads/mine", price: 35_200 },
    );
    const q = new URL(calls[0]).searchParams;
    assert.equal(q.get("link"), "https://example.invalid/ads/mine");
    assert.equal(q.get("price"), "35200");
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
