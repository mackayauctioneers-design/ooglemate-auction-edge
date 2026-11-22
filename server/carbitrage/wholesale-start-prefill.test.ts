import { it } from "node:test";
import assert from "node:assert/strict";
import { startPrefill } from "../../src/portal/wholesale/startPrefill.ts";

it("pre-fills the returned car identity and km without confirming the odometer", () => {
  const fields = startPrefill(new URLSearchParams("rego=abc123&state=NSW&year=2022&make=Porsche&model=Macan&badge=S&km=94273"));
  assert.deepEqual(fields, { rego: "ABC123", state: "NSW", year: "2022", make: "Porsche", model: "Macan", badge: "S", odo: "94273", adLink: "", asking: "" });
  assert.equal("checked" in fields, false);
});
it("keeps ordinary New car entry empty without query fields", () => { assert.deepEqual(startPrefill(new URLSearchParams()), { rego: "", state: "", year: "", make: "", model: "", badge: "", odo: "", adLink: "", asking: "" }); });
it("does not substitute a guessed odometer for invalid link input", () => { assert.equal(startPrefill(new URLSearchParams("km=invalid")).odo, ""); assert.equal(startPrefill(new URLSearchParams("km=-100")).odo, ""); });