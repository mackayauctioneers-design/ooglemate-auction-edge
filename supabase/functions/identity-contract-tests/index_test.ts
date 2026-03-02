/**
 * IDENTITY CONTRACT TEST — Real-World Fixture Validation
 * 
 * Tests canonical identity functions against 20 real-world edge cases
 * derived from actual vehicle_listings data.
 * 
 * These fixtures validate:
 * 1. Prado vs LandCruiser platform separation
 * 2. SR vs SR5 badge isolation
 * 3. GX vs GXL boundary
 * 4. ST vs ST-X vs ST-L boundary
 * 5. Multi-word model preservation
 * 6. Platform class consistency
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePlatform, extractBadge } from "../_shared/taxonomy/derivePlatform.ts";

// ─── FIXTURE DATA (from live vehicle_listings, 2026-03-02) ────────────────────

type Fixture = {
  id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  expected_platform: string;
  expected_badge: string;
  description: string;
};

const FIXTURES: Fixture[] = [
  // ── Prado vs LandCruiser (the #1 collision risk) ──
  { id: "F01", make: "TOYOTA", model: "LANDCRUISER PRADO", variant_raw: "VX", expected_platform: "PRADO", expected_badge: "VX", description: "Prado VX — model contains PRADO" },
  { id: "F02", make: "TOYOTA", model: "LANDCRUISER", variant_raw: "VX", expected_platform: "LANDCRUISER", expected_badge: "VX", description: "LC200/300 VX — NOT Prado" },
  { id: "F03", make: "TOYOTA", model: "LANDCRUISER PRADO", variant_raw: "GXL", expected_platform: "PRADO", expected_badge: "GXL", description: "Prado GXL" },
  { id: "F04", make: "TOYOTA", model: "LANDCRUISER", variant_raw: "SAHARA", expected_platform: "LANDCRUISER", expected_badge: "SAHARA", description: "LC SAHARA — must not be Prado" },
  { id: "F05", make: "TOYOTA", model: "LANDCRUISER", variant_raw: "GR-S", expected_platform: "LANDCRUISER", expected_badge: "GR", description: "LC300 GR-S — GR badge family" },
  { id: "F06", make: "TOYOTA", model: "PRADO", variant_raw: "GX", expected_platform: "PRADO", expected_badge: "GX", description: "Prado short model name" },

  // ── SR vs SR5 (the #2 collision risk) ──
  { id: "F07", make: "TOYOTA", model: "HILUX", variant_raw: "SR5", expected_platform: "TOYOTA:HILUX", expected_badge: "SR5", description: "Hilux SR5 must not return SR" },
  { id: "F08", make: "TOYOTA", model: "HILUX", variant_raw: "SR", expected_platform: "TOYOTA:HILUX", expected_badge: "SR", description: "Hilux SR — distinct from SR5" },
  { id: "F09", make: "TOYOTA", model: "HILUX", variant_raw: "SR5 4x4 Dual Cab Auto", expected_platform: "TOYOTA:HILUX", expected_badge: "SR5", description: "SR5 with noise words" },
  { id: "F10", make: "TOYOTA", model: "HILUX", variant_raw: "WORKMATE", expected_platform: "TOYOTA:HILUX", expected_badge: "WORKMATE", description: "Hilux Workmate" },

  // ── GX vs GXL (the #3 collision risk) ──
  { id: "F11", make: "TOYOTA", model: "LANDCRUISER PRADO", variant_raw: "GX", expected_platform: "PRADO", expected_badge: "GX", description: "Prado GX — must not match GXL" },
  { id: "F12", make: "TOYOTA", model: "LANDCRUISER PRADO", variant_raw: "GXL", expected_platform: "PRADO", expected_badge: "GXL", description: "Prado GXL — distinct from GX" },

  // ── Ford Ranger badges ──
  { id: "F13", make: "FORD", model: "RANGER", variant_raw: "XLT", expected_platform: "FORD:RANGER", expected_badge: "XLT", description: "Ranger XLT" },
  { id: "F14", make: "FORD", model: "RANGER", variant_raw: "WILDTRAK", expected_platform: "FORD:RANGER", expected_badge: "WILDTRAK", description: "Ranger Wildtrak" },
  { id: "F15", make: "FORD", model: "RANGER", variant_raw: "XL", expected_platform: "FORD:RANGER", expected_badge: "XL", description: "Ranger XL — must not match XLT/XLS" },

  // ── Isuzu D-Max variants ──
  { id: "F16", make: "ISUZU", model: "D-MAX", variant_raw: "X-TERRAIN", expected_platform: "ISUZU:D-MAX", expected_badge: "X-TERRAIN", description: "D-Max X-Terrain" },
  { id: "F17", make: "ISUZU", model: "D-MAX", variant_raw: "LS-U", expected_platform: "ISUZU:D-MAX", expected_badge: "LS-U", description: "D-Max LS-U" },

  // ── Nissan Navara ST vs ST-X ──
  { id: "F18", make: "NISSAN", model: "NAVARA", variant_raw: "ST-X", expected_platform: "NISSAN:NAVARA", expected_badge: "ST-X", description: "Navara ST-X — must not match ST alone" },
  { id: "F19", make: "NISSAN", model: "PATROL", variant_raw: "TI", expected_platform: "PATROL", expected_badge: "TI", description: "Patrol gets PATROL platform" },

  // ── Mitsubishi Pajero Sport separation ──
  { id: "F20", make: "MITSUBISHI", model: "PAJERO SPORT", variant_raw: "EXCEED", expected_platform: "PAJERO_SPORT", expected_badge: "EXCEED", description: "Pajero Sport must differ from Pajero" },
];

// ─── RUN ALL FIXTURES ────────────────────────────────────────────────────────

for (const f of FIXTURES) {
  Deno.test(`Contract ${f.id}: ${f.description}`, () => {
    const platform = derivePlatform(f.make, f.model);
    assertEquals(platform, f.expected_platform, `${f.id} platform mismatch`);

    const badge = extractBadge(f.variant_raw);
    assertEquals(badge, f.expected_badge, `${f.id} badge mismatch`);
  });
}

// ─── CROSS-COLLISION ASSERTIONS ──────────────────────────────────────────────

Deno.test("Contract: Prado fixtures never share platform with LC fixtures", () => {
  const pradoFixtures = FIXTURES.filter(f => f.expected_platform === "PRADO");
  const lcFixtures = FIXTURES.filter(f => f.expected_platform === "LANDCRUISER");

  for (const p of pradoFixtures) {
    for (const l of lcFixtures) {
      const pp = derivePlatform(p.make, p.model);
      const lp = derivePlatform(l.make, l.model);
      assertNotEquals(pp, lp, `${p.id} and ${l.id} should have different platforms`);
    }
  }
});

Deno.test("Contract: SR and SR5 fixtures produce different badges", () => {
  const sr = extractBadge("HILUX SR 4x2");
  const sr5 = extractBadge("HILUX SR5 4x4");
  assertNotEquals(sr, sr5, "SR and SR5 must produce different badges");
});
