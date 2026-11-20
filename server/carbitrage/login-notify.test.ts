import assert from "node:assert/strict";
import { test } from "node:test";
import { isCarbitragePortalPath, signInActions } from "../../src/contexts/signInPolicy.ts";

/** Franchise login notifications (Macka OK 20 Nov 2026): /portal/* sign-ins are logged and notified, without Ooglecars profile lookups. */

test("portal sign-in: login row + notification, no Ooglecars profile lookup", () => {
  for (const path of ["/portal/login", "/portal/buyer-view", "/portal/wholesale/start", "/portal"]) {
    assert.deepEqual(signInActions(path, "SIGNED_IN"), { loadOoglecarsProfile: false, recordLogin: true, notifyLogin: true }, path);
  }
});

test("Ooglecars sign-in is unchanged: profile lookup, login row, notification", () => {
  for (const path of ["/auth", "/today", "/", "/dealer-home", "/portalx"]) {
    assert.deepEqual(signInActions(path, "SIGNED_IN"), { loadOoglecarsProfile: true, recordLogin: true, notifyLogin: true }, path);
  }
});

test("only a fresh SIGNED_IN is a login: token refresh, initial session and sign-out record and notify nothing", () => {
  for (const event of ["TOKEN_REFRESHED", "INITIAL_SESSION", "USER_UPDATED", "SIGNED_OUT"]) {
    for (const path of ["/portal/buyer-view", "/today"]) {
      const a = signInActions(path, event);
      assert.equal(a.recordLogin, false, `${event} ${path}`);
      assert.equal(a.notifyLogin, false, `${event} ${path}`);
    }
  }
});

test("portal path detection is exact", () => {
  assert.equal(isCarbitragePortalPath("/portal/x"), true);
  assert.equal(isCarbitragePortalPath("/portalish"), false);
  assert.equal(isCarbitragePortalPath(undefined), false);
});
