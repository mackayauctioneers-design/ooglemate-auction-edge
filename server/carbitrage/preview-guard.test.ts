import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_NOW } from "./domain.ts";
import { seedDemo } from "./fixtures.ts";
import { memoryDirectory, startCarbitrageServer } from "./http.ts";
import { assertPreviewIsolated, previewGateCookie, productionShapedKeys } from "./preview-guard.ts";
import { MemoryStore, memoryPort } from "./store.ts";

const GATE = "preview-test-gate-secret";

test("preview mode names production-shaped keys and refuses to start", () => {
  const env = {
    CARBITRAGE_ENV: "preview",
    SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "present",
    CARBITRAGE_DATABASE_URL: "postgresql://role:secret@127.0.0.1:5432/carbitrage_demo",
  };
  const names = productionShapedKeys(env);
  assert.equal(names.includes("SUPABASE_URL"), true);
  assert.equal(names.includes("VITE_SUPABASE_PUBLISHABLE_KEY"), true);
  assert.equal(names.includes("CARBITRAGE_DATABASE_URL"), false);
  assert.equal(JSON.stringify(names).includes("example.supabase.co"), false);
  assert.throws(() => assertPreviewIsolated(env), /SUPABASE_URL/);
  assert.throws(() => assertPreviewIsolated({ CARBITRAGE_ENV: "preview" }), /CARBITRAGE_PREVIEW_GATE_FILE/);
  assertPreviewIsolated({
    CARBITRAGE_ENV: "preview",
    CARBITRAGE_PREVIEW_GATE_FILE: ".carbitrage-local/preview-gate",
    CARBITRAGE_DATABASE_URL: "postgresql://role:secret@127.0.0.1:5432/carbitrage_demo",
  });
  assertPreviewIsolated({ CARBITRAGE_ENV: "local", SUPABASE_URL: "https://example.supabase.co" });
});

test("preview gate blocks demo, ingest and mcp until the password cookie is set", async () => {
  const store = new MemoryStore();
  const secrets = seedDemo(store, "demo-only", DEMO_NOW);
  const server = await startCarbitrageServer({
    data: memoryPort(store),
    directory: memoryDirectory(store),
    sessionSecret: "gate-test",
    demoMode: true,
    jwtSecret: null,
    oauthIssuer: null,
    oauthResourceUrl: null,
    persistence: "memory",
    now: () => DEMO_NOW,
    previewGate: { secret: GATE },
  });
  try {
    const page = await fetch(`${server.url}/portal/login`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(html.includes("Private preview"), true);
    assert.equal(html.includes("Patrick Auto"), false);
    const demo = await fetch(`${server.url}/api/carbitrage/session/demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "patrick" }),
    });
    assert.equal(demo.status, 401);
    const ingest = await fetch(`${server.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${secrets.ingestToken}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(ingest.status, 401);
    const mcp = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${secrets.users.patrick.mcpKey}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(mcp.status, 401);
    const bad = await fetch(`${server.url}/api/carbitrage/preview-gate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(bad.status, 401);
    const good = await fetch(`${server.url}/api/carbitrage/session/demo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: previewGateCookie(GATE).split(";")[0],
      },
      body: JSON.stringify({ persona: "patrick" }),
    });
    assert.equal(good.status, 200);
  } finally {
    await server.close();
  }
});
