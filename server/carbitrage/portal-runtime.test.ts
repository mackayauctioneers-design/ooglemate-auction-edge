import assert from "node:assert/strict";
import test from "node:test";
import { VPS_API, portalCall, portalSignIn } from "../../src/portal/runtime-plan.ts";

const TOKEN = "ooglecars-access-token";
const HOSTS = ["carbitrage.com.au", "www.carbitrage.com.au", "id-preview--92b962ba-8cbd-4e77-b734-dd01c5a9be50.lovable.app"];

/** Every portal and wholesale call the dealer screens make. */
const PATHS = [
  "/api/carbitrage/health",
  "/api/carbitrage/me",
  "/api/carbitrage/session",
  "/api/carbitrage/finds",
  "/api/carbitrage/profile",
  "/api/carbitrage/insights",
  "/api/carbitrage/alerts",
  "/api/carbitrage/sales-import",
  "/api/carbitrage/sales-import/sample",
  "/api/carbitrage/mcp/tools",
  "/api/carbitrage/mcp-keys",
  "/api/wholesale/info",
  "/api/wholesale/me",
  "/api/wholesale/guide",
  "/api/wholesale/send",
  "/api/wholesale/buyers",
  "/api/wholesale/lookup",
  "/api/wholesale/requests",
  "/api/wholesale/updates",
  "/api/wholesale/buyer/cars",
  "/api/wholesale/buyer/price",
  "/api/wholesale/buyer/history",
  "/api/wholesale/buyer/alerts",
  "/api/wholesale/buyer/list",
];

test("on carbitrage.com.au every API call goes to the VPS with a Bearer token and no cookies", () => {
  for (const host of HOSTS) {
    for (const path of PATHS) {
      const call = portalCall(host, path, TOKEN);
      assert.equal(call.url, `${VPS_API}${path}`, host);
      assert.equal(call.credentials, "omit", path);
      assert.deepEqual(call.headers, { authorization: `Bearer ${TOKEN}` });
    }
  }
});

test("same-origin preview stays on relative /api with the session cookie and no bearer", () => {
  for (const host of ["localhost", "127.0.0.1", "preview.example"]) {
    const call = portalCall(host, "/api/wholesale/guide", TOKEN);
    assert.equal(call.url, "/api/wholesale/guide");
    assert.equal(call.credentials, "include");
    assert.deepEqual(call.headers, {});
  }
  const forced = portalCall("carbitrage.com.au", "/api/wholesale/me", TOKEN, "");
  assert.equal(forced.url, "/api/wholesale/me");
  assert.equal(forced.credentials, "include");
});

test("production sign-in uses the Ooglecars client; preview and dev keep the shared one", () => {
  const prod = portalSignIn("production", false);
  assert.equal(prod.kind, "ooglecars");
  if (prod.kind !== "ooglecars") return;
  assert.match(prod.url, /^https:\/\/esyinwxhcpexncgqcnwi\.supabase\.co$/);
  assert.equal(prod.storageKey, "carbitrage-portal-auth");
  assert.equal(portalSignIn("preview", false).kind, "shared");
  assert.equal(portalSignIn("production", true).kind, "shared");
});
