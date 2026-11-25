import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOwnerPushes, OWNER_PUSH_DEALER_NAMES } from "../../supabase/functions/score-operator-opportunities/ownerPush.ts";

const row = (over: Record<string, unknown> = {}) => ({
  tier: "HIGH",
  year: 2022,
  make: "Toyota",
  model: "Hilux",
  listing_source: "carsales",
  best_account_name: "ACM Cars & Commercial",
  ...over,
});

describe("buildOwnerPushes", () => {
  it("pushes only to the owner, never to yard accounts", () => {
    const pushes = buildOwnerPushes([
      row({ best_account_name: "ACM Cars & Commercial" }),
      row({ best_account_name: "Patrick Auto Group" }),
    ]);
    assert.equal(pushes.length, OWNER_PUSH_DEALER_NAMES.length);
    for (const p of pushes) {
      assert.equal(p.dealer_name, "Mackay Traders");
      assert.notEqual(p.dealer_name, "ACM Cars & Commercial");
      assert.notEqual(p.dealer_name, "Patrick Auto Group");
    }
  });

  it("never produces a push with an empty dealer_name", () => {
    const pushes = buildOwnerPushes([row()]);
    assert.ok(pushes.length > 0);
    for (const p of pushes) assert.ok(p.dealer_name && p.dealer_name.trim().length > 0);
  });

  it("returns no pushes when there are no rows", () => {
    assert.deepEqual(buildOwnerPushes([]), []);
  });

  it("ignores rows whose tier is not a notify tier", () => {
    const pushes = buildOwnerPushes([
      row({ tier: "WATCH" }),
      row({ tier: "PASS" }),
      row({ tier: "LOW" }),
    ]);
    assert.deepEqual(pushes, []);
  });

  it("includes every notify tier", () => {
    for (const tier of ["CODE_RED", "HIGH", "BUY", "AUCTION_WATCH"]) {
      assert.ok(buildOwnerPushes([row({ tier })]).length > 0, `${tier} should notify`);
    }
  });

  it("summarises count and appends the yard name for context only", () => {
    const [p] = buildOwnerPushes([
      row({ best_account_name: "ACM Cars & Commercial" }),
      row({ best_account_name: "Patrick Auto Group" }),
      row({ best_account_name: null }),
    ]);
    assert.match(p.title, /3 new matches/);
    assert.match(p.body, /\(\+2 more\)/);
    assert.match(p.body, /→ ACM Cars & Commercial/);
    assert.equal(p.url, "/operator/trading-desk");
    assert.equal(p.force, false);
  });
});
