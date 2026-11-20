import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromApiValuation, mapGuide, type EngineValuation } from "./wholesale-guide.ts";

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

test("the live API answer maps to the same guide figures as value_car (Macan, 20 Nov)", () => {
  const guide = mapGuide(fromApiValuation(load("wholesale-macan-api-live-20261120.json")), 2022, NOW);
  assert.ok(guide);
  assert.equal(guide.floor_dollars, 82990);
  assert.equal(guide.thinking, 71400);
  assert.equal(guide.cautious, 70400);
  assert.equal(guide.year_below?.year, 2021);
  assert.ok(guide.comps.length > 0 && guide.comps.every((c) => c.year === 2022 && c.link !== guide.floor_car.link));
});
