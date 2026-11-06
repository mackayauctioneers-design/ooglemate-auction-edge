import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { detectPriceType, normaliseToOffroad } from "../../supabase/functions/_shared/price-normalisation.ts";
import { extractSeries } from "../../supabase/functions/_shared/taxonomy/derivePlatform.ts";
import { computeMarketRange, computeTradeInOffer } from "../../supabase/functions/_shared/valo/scoreValoComps.ts";
import { DEMO_NOW, displayedFloor, type SaleRecord } from "./domain.ts";

test("original off-road normaliser and VALO range stay distinct from the preview own-sale median", () => {
  assert.equal(detectPriceType("Drive away $46,990"), "drive_away");
  assert.equal(detectPriceType("Excl. govt charges"), "excl_govt");
  assert.equal(detectPriceType("Synthetic auction catalogue"), "unknown");

  const driveAway = 100_000;
  const qldOffroad = normaliseToOffroad(driveAway, "drive_away", "QLD");
  assert.equal(qldOffroad, Math.round(driveAway / 1.05));
  assert.equal(normaliseToOffroad(driveAway, "excl_govt", "QLD"), driveAway);
  assert.equal(normaliseToOffroad(driveAway, "unknown", "QLD"), driveAway);
  assert.equal(normaliseToOffroad(46_990, detectPriceType("Synthetic auction catalogue"), "QLD"), 46_990);

  const thin = computeMarketRange([
    { price: 50_000, url: "https://example.invalid/a" },
    { price: 52_000, url: "https://example.invalid/b" },
  ] as never);
  assert.equal(thin, null);

  const market = computeMarketRange([
    { price: 48_000, url: "https://example.invalid/a" },
    { price: 50_000, url: "https://example.invalid/b" },
    { price: 52_000, url: "https://example.invalid/c" },
  ] as never);
  assert.ok(market);
  assert.equal(market.median, 50_000);
  const offer = computeTradeInOffer(market.median, { allowance_aud: 1000, condition: "good" } as never);
  assert.equal(offer.recon_buffer_used, 1500);
  assert.equal(offer.mid, 50_000 - 1000 - 1500);

  const sale: SaleRecord = {
    id: "sale_one",
    yardId: "yard_patrick",
    dedupeKey: "one",
    stockNo: null,
    soldAt: "2026-09-27T00:00:00.000Z",
    make: "Toyota",
    model: "Hilux",
    variant: "E",
    year: 2020,
    odometerKm: 80000,
    price: 52_000,
    priceBasis: "ex_gov",
    synthetic: true,
    adapter: "seed",
  };
  const own = displayedFloor(
    { yardId: "yard_patrick", make: "Toyota", model: "Hilux", variant: "E", variantMatch: "matched" },
    [sale],
    DEMO_NOW,
  );
  assert.equal(own.floorExGov, 52_000);
  assert.notEqual(own.floorExGov, offer.mid);
  assert.equal((own.floorSource ?? "").includes("Not a VALO market range"), true);

  assert.equal(extractSeries("Toyota", "LandCruiser 300 Sahara"), "LC300");
  assert.equal(extractSeries("Toyota", "LandCruiser 200"), "LC200");
  assert.notEqual(
    extractSeries("Toyota", "LandCruiser 300 Sahara"),
    extractSeries("Toyota", "LandCruiser 200"),
  );
  assert.equal(extractSeries("Toyota", "LandCruiser"), null);

  const unexpected = readFileSync(new URL("../../src/hooks/useUnexpectedWinners.ts", import.meta.url), "utf8");
  const forgotten = readFileSync(new URL("../../memory/logic/carbitrage/forgotten-winners-treatment-v1", import.meta.url), "utf8");
  assert.equal(unexpected.includes("priceRatio >= 1.3"), true);
  assert.equal(unexpected.includes("profitDollars >= 5000"), true);
  assert.equal(unexpected.includes("2500"), false);
  assert.equal(forgotten.includes("$2500"), true);
});
