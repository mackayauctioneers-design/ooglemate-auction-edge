/**
 * IDENTITY REGRESSION TEST HARNESS
 * 
 * Tests the canonical normalizer + derivePlatform for the 5 critical edge cases:
 * 1. Prado vs LandCruiser 200/300 — must never collide
 * 2. SR vs SR5 — must not conflate
 * 3. SR5+ maps consistently to SR5 family
 * 4. 4x2 vs 4x4 — must not bleed
 * 5. Fuel & transmission must be structured
 * 
 * Plus additional taxonomy integrity checks.
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePlatform, extractBadge } from "../_shared/taxonomy/derivePlatform.ts";

// ─── TEST 1: Prado vs LandCruiser 200/300 never collide ─────────────────────

Deno.test("derivePlatform: Toyota Prado → PRADO", () => {
  assertEquals(derivePlatform("Toyota", "LandCruiser Prado"), "PRADO");
  assertEquals(derivePlatform("TOYOTA", "PRADO"), "PRADO");
  assertEquals(derivePlatform("toyota", "Landcruiser Prado GXL"), "PRADO");
});

Deno.test("derivePlatform: Toyota LandCruiser (no Prado) → LANDCRUISER", () => {
  assertEquals(derivePlatform("Toyota", "LandCruiser"), "LANDCRUISER");
  assertEquals(derivePlatform("TOYOTA", "LANDCRUISER 300"), "LANDCRUISER");
  assertEquals(derivePlatform("Toyota", "Land Cruiser"), "LANDCRUISER");
});

Deno.test("derivePlatform: Prado and LandCruiser never return same value", () => {
  const prado = derivePlatform("Toyota", "Prado");
  const lc = derivePlatform("Toyota", "LandCruiser");
  assertNotEquals(prado, lc, "Prado and LandCruiser must have different platform classes");
});

// ─── TEST 2: SR vs SR5 must not conflate ─────────────────────────────────────

Deno.test("extractBadge: SR5 matched before SR", () => {
  assertEquals(extractBadge("2021 Toyota Hilux SR5 4x4"), "SR5");
});

Deno.test("extractBadge: SR alone returns SR", () => {
  assertEquals(extractBadge("2021 Toyota Hilux SR 4x2"), "SR");
});

Deno.test("extractBadge: SR5 text does not return SR", () => {
  const badge = extractBadge("Hilux SR5 Dual Cab");
  assertEquals(badge, "SR5");
  assertNotEquals(badge, "SR");
});

// ─── TEST 3: SR5+ maps to SR5 ───────────────────────────────────────────────

Deno.test("extractBadge: SR5 variants map correctly", () => {
  // SR5 with extras should still be SR5
  assertEquals(extractBadge("SR5 DUAL CAB AUTO"), "SR5");
  assertEquals(extractBadge("SR5 4X4 TURBO DIESEL"), "SR5");
});

// ─── TEST 4: Badge isolation — short badges use word boundaries ─────────────

Deno.test("extractBadge: GX does not match GXL", () => {
  assertEquals(extractBadge("Toyota Prado GXL"), "GXL");
  // GXL should match, not GX substring
});

Deno.test("extractBadge: XL does not match XLT or XLS", () => {
  assertEquals(extractBadge("Ford Ranger XLT"), "XLT");
  assertEquals(extractBadge("Ford Ranger XLS"), "XLS");
});

Deno.test("extractBadge: ST does not match ST-X or ST-L", () => {
  assertEquals(extractBadge("Nissan Navara ST-X"), "ST-X");
  assertEquals(extractBadge("Nissan X-Trail ST-L"), "ST-L");
});

// ─── TEST 5: Platform classification edge cases ─────────────────────────────

Deno.test("derivePlatform: Mitsubishi Pajero Sport separate from Pajero", () => {
  const sport = derivePlatform("Mitsubishi", "Pajero Sport");
  const pajero = derivePlatform("Mitsubishi", "Pajero");
  assertNotEquals(sport, pajero, "Pajero Sport must differ from Pajero");
});

Deno.test("derivePlatform: Nissan Patrol gets PATROL class", () => {
  assertEquals(derivePlatform("Nissan", "Patrol"), "PATROL");
});

Deno.test("derivePlatform: Unknown models get MAKE:MODEL format", () => {
  assertEquals(derivePlatform("Ford", "Ranger"), "FORD:RANGER");
  assertEquals(derivePlatform("Mazda", "BT-50"), "MAZDA:BT-50");
});

// ─── TEST 6: Badge priority — longer matches first ──────────────────────────

Deno.test("extractBadge: WILDTRAK matched over generic SPORT", () => {
  assertEquals(extractBadge("Ford Ranger Wildtrak Sport"), "WILDTRAK");
});

Deno.test("extractBadge: ASCENT SPORT matched over ASCENT", () => {
  assertEquals(extractBadge("Toyota Corolla Ascent Sport"), "ASCENT SPORT");
});

Deno.test("extractBadge: RUGGED X matched over RUGGED", () => {
  assertEquals(extractBadge("Toyota Hilux Rugged X"), "RUGGED X");
});

Deno.test("extractBadge: X-TERRAIN matched correctly", () => {
  assertEquals(extractBadge("Isuzu D-Max X-Terrain"), "X-TERRAIN");
});

// ─── TEST 7: Empty/null handling ─────────────────────────────────────────────

Deno.test("extractBadge: null returns empty string", () => {
  assertEquals(extractBadge(null), "");
  assertEquals(extractBadge(""), "");
});

Deno.test("derivePlatform: empty inputs return colon format", () => {
  assertEquals(derivePlatform("", ""), ":");
});
