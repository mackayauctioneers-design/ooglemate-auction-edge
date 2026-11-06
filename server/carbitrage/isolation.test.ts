import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DEMO_NOW } from "./domain.ts";
import { seedDemo, type Persona, type SeedSecrets } from "./fixtures.ts";
import { startCarbitrageServer } from "./http.ts";
import { JsonFileStore, MemoryStore } from "./store.ts";

const SECRET = "test-session-secret";

async function boot(demoMode = true) {
  const store = new MemoryStore();
  const secrets = seedDemo(store, "demo-only", DEMO_NOW);
  const server = await startCarbitrageServer({
    store,
    sessionSecret: SECRET,
    demoMode,
    now: () => DEMO_NOW,
  });
  return { store, secrets, server };
}

function cookieFrom(res: Response): string {
  const line = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
  assert.ok(line, "expected a session cookie");
  return line.split(";")[0];
}

async function login(url: string, secrets: SeedSecrets, persona: Persona): Promise<string> {
  const res = await fetch(`${url}/api/carbitrage/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: secrets.users[persona].email, password: secrets.password }),
  });
  assert.equal(res.status, 200);
  return cookieFrom(res);
}

async function mcp(url: string, token: string, method: string, params: unknown, id: number | null = 1) {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function textOf(body: { result?: { content?: { text?: string }[]; isError?: boolean } }): string {
  return body.result?.content?.[0]?.text ?? "";
}

test("unauthenticated list, detail, mcp and ingest are denied", async () => {
  const { secrets, server } = await boot();
  try {
    const list = await fetch(`${server.url}/api/carbitrage/finds`);
    assert.equal(list.status, 401);
    const detail = await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-auction-hilux`);
    assert.equal(detail.status, 401);
    const mcpRes = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(mcpRes.status, 401);
    const ingest = await fetch(`${server.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yardId: "yard_patrick" }),
    });
    assert.equal(ingest.status, 401);
    const health = await fetch(`${server.url}/api/carbitrage/health`);
    const healthBody = await health.text();
    assert.equal(health.status, 200);
    assert.equal(healthBody.includes(secrets.markers.otherYard), false);
    assert.equal(healthBody.includes("8123456"), false);
  } finally {
    await server.close();
  }
});

test("other yard and unauthorised group cannot read or change patrick data", async () => {
  const { secrets, server } = await boot();
  try {
    const patrick = await login(server.url, secrets, "patrick");
    const outsider = await login(server.url, secrets, "outsider");
    const north = await login(server.url, secrets, "north");
    const titled = await login(server.url, secrets, "titled");
    const group = await login(server.url, secrets, "group");

    const own = await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie: patrick } });
    const ownBody = await own.text();
    assert.equal(own.status, 200);
    assert.equal(ownBody.includes("Hilux"), true);
    assert.equal(ownBody.includes(secrets.markers.otherYard), false);
    assert.equal(ownBody.includes(secrets.markers.south), false);

    const forged = await fetch(`${server.url}/api/carbitrage/finds?yardId=yard_other`, {
      headers: { cookie: patrick, "x-yard-id": "yard_other" },
    });
    assert.equal(forged.status, 403);
    const forgedText = await forged.text();
    assert.equal(forgedText.includes("8123456"), false);

    const detail = await fetch(`${server.url}/api/carbitrage/finds/opp_syn-other-1`, { headers: { cookie: patrick } });
    assert.equal(detail.status, 403);
    assert.equal((await detail.text()).includes("8123456"), false);

    const northList = await (await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie: north } })).text();
    assert.equal(northList.includes(secrets.markers.north), true);
    assert.equal(northList.includes(secrets.markers.south), false);

    const titledList = await (await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie: titled } })).text();
    assert.equal(titledList.includes(secrets.markers.south), false);
    const titledProfile = await (await fetch(`${server.url}/api/carbitrage/profile`, { headers: { cookie: titled } })).json();
    assert.equal(titledProfile.profiles.length, 1);
    assert.equal(titledProfile.profiles[0].role, "group_admin");

    const groupList = await (await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie: group } })).text();
    assert.equal(groupList.includes(secrets.markers.north), true);
    assert.equal(groupList.includes(secrets.markers.south), true);

    const workflow = await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-auction-hilux/workflow`, {
      method: "POST",
      headers: { cookie: outsider, "content-type": "application/json" },
      body: JSON.stringify({ status: "passed", watchlisted: true }),
    });
    assert.equal(workflow.status, 403);

    const mcpDenied = await mcp(server.url, secrets.users.outsider.mcpKey, "tools/call", {
      name: "get_find",
      arguments: { id: "opp_syn-patrick-auction-hilux" },
    });
    assert.equal(mcpDenied.body.result.isError, true);
    assert.equal(textOf(mcpDenied.body).includes("46990"), false);

    const mcpYard = await mcp(server.url, secrets.users.north.mcpKey, "tools/call", {
      name: "list_finds",
      arguments: { yardId: "yard_ktmg_south" },
    });
    assert.equal(mcpYard.body.result.isError, true);
    assert.equal(textOf(mcpYard.body).includes(secrets.markers.south), false);
  } finally {
    await server.close();
  }
});

test("website and mcp read the same persisted find; ingest retries dedupe and keep source", async () => {
  const { secrets, server, store } = await boot();
  try {
    const patrick = await login(server.url, secrets, "patrick");
    const payload = {
      externalId: "retry-hilux-1",
      sourceSystem: "vps_synthetic",
      sourceChannel: "auction",
      sourceUrl: "https://example.invalid/synthetic/auction/retry-hilux-1",
      sourceLabel: "Synthetic retry auction",
      capturedAt: "2026-11-05T00:00:00.000Z",
      yardId: "yard_patrick",
      year: 2019,
      make: "Toyota",
      model: "Hilux",
      variant: "SR",
      variantMatch: "matched",
      odometerKm: 100000,
      askingPrice: 33333,
      floorExGov: 36000,
      floorSource: "synthetic own sales",
      floorAsOf: "2026-11-01",
      photoUrl: "/portal-demo/hilux.jpg",
      photoCredit: "Wikimedia Commons",
      synthetic: true,
      envelope: { listingRef: "retry-hilux-1", catalogue: "synthetic-source-kept" },
    };
    const headers = { authorization: `Bearer ${secrets.ingestToken}`, "content-type": "application/json" };
    const first = await fetch(`${server.url}/api/carbitrage/ingest`, { method: "POST", headers, body: JSON.stringify(payload) });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.attempts, 1);

    const second = await fetch(`${server.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, askingPrice: 1 }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.created, false);
    assert.equal(secondBody.attempts, 2);
    assert.equal(secondBody.opportunityId, firstBody.opportunityId);
    assert.equal(secondBody.priceChangedIgnored, true);
    const stored = store.snapshot().opportunities.filter((row) => row.externalId === "retry-hilux-1");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].askingPrice, 33333);
    assert.equal(stored[0].sourceEnvelope.listingRef, "retry-hilux-1");

    const httpFind = await (await fetch(`${server.url}/api/carbitrage/finds/${firstBody.opportunityId}`, { headers: { cookie: patrick } })).json();
    const mcpFind = await mcp(server.url, secrets.users.patrick.mcpKey, "tools/call", {
      name: "get_find",
      arguments: { id: firstBody.opportunityId },
    });
    assert.equal(mcpFind.body.result.isError, false);
    assert.deepEqual(JSON.parse(textOf(mcpFind.body)), httpFind);
    assert.equal(httpFind.askingPrice, 33333);
    assert.equal(httpFind.sourceRetained, true);
    assert.equal(httpFind.sourceEnvelope.catalogue, "synthetic-source-kept");

    const listed = await mcp(server.url, secrets.users.patrick.mcpKey, "tools/call", { name: "list_finds", arguments: {} });
    const listJson = JSON.parse(textOf(listed.body)) as { id: string }[];
    assert.equal(listJson.some((row) => row.id === firstBody.opportunityId), true);

    const forged = await fetch(`${server.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, externalId: "forged-yard", yardId: "yard_other" }),
    });
    assert.equal(forged.status, 403);
    assert.equal(store.snapshot().opportunities.some((row) => row.externalId === "forged-yard"), false);

    const autograb = await fetch(`${server.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, externalId: "grab", sourceUrl: "https://www.autograb.com/listing/1" }),
    });
    assert.equal(autograb.status, 400);
    assert.equal(store.snapshot().opportunities.some((row) => row.externalId === "grab"), false);
  } finally {
    await server.close();
  }
});

test("own workflow updates stick and another yard cannot apply them", async () => {
  const { secrets, server } = await boot();
  try {
    const patrick = await login(server.url, secrets, "patrick");
    const updated = await mcp(server.url, secrets.users.patrick.mcpKey, "tools/call", {
      name: "update_find_workflow",
      arguments: { id: "opp_syn-patrick-auction-hilux", status: "shortlisted", watchlisted: true },
    });
    assert.equal(updated.body.result.isError, false);
    const detail = await (await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-auction-hilux`, { headers: { cookie: patrick } })).json();
    assert.equal(detail.status, "shortlisted");
    assert.equal(detail.watchlisted, true);

    const other = await mcp(server.url, secrets.users.outsider.mcpKey, "tools/call", {
      name: "update_find_workflow",
      arguments: { id: "opp_syn-patrick-auction-hilux", status: "passed", watchlisted: false },
    });
    assert.equal(other.body.result.isError, true);
    const again = await (await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-auction-hilux`, { headers: { cookie: patrick } })).json();
    assert.equal(again.status, "shortlisted");
    assert.equal(again.watchlisted, true);
  } finally {
    await server.close();
  }
});

test("standalone dealer works without an Ooglecars yard id", async () => {
  const { secrets, server } = await boot();
  try {
    const cookie = await login(server.url, secrets, "patrick");
    const me = await (await fetch(`${server.url}/api/carbitrage/me`, { headers: { cookie } })).json();
    assert.equal(me.ooglecarsRequired, false);
    assert.equal(me.yards[0].ooglecarsYardId, null);
    assert.equal(me.entitlement.billingEnabled, false);
    const profile = await (await fetch(`${server.url}/api/carbitrage/profile`, { headers: { cookie } })).json();
    assert.equal(profile.profiles[0].yard.kind, "standalone_franchise");
    assert.equal(profile.profiles[0].yard.franchise, "Patrick Auto");
    assert.equal(profile.profiles[0].yard.ooglecarsRequired, false);
    assert.ok(profile.profiles[0].mandates.some((row: { model: string }) => row.model === "Hilux"));
    const finds = await (await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie } })).json();
    assert.ok(finds.finds.length >= 7);
    const channels = new Set(finds.finds.map((row: { sourceChannel: string }) => row.sourceChannel));
    for (const channel of ["auction", "fleet_lease", "government", "dealer_retail", "aged_stock", "wholesale_trade", "private"]) {
      assert.equal(channels.has(channel), true, channel);
    }
    const gov = finds.finds.find((row: { sourceChannel: string }) => row.sourceChannel === "government");
    assert.equal(gov.floorExGov, null);
    assert.equal(gov.underFloorPct, null);
    const addon = await (await fetch(`${server.url}/api/carbitrage/profile`, { headers: { cookie: await login(server.url, secrets, "addon") } })).json();
    assert.equal(addon.profiles[0].yard.ooglecarsYardId, "oc-yard-synthetic-1");
  } finally {
    await server.close();
  }
});

test("insights keep other yards private and redact sales older than six months", async () => {
  const { secrets, server } = await boot();
  try {
    const patrick = await login(server.url, secrets, "patrick");
    const insights = await (await fetch(`${server.url}/api/carbitrage/insights`, { headers: { cookie: patrick } })).json();
    const blob = JSON.stringify(insights);
    assert.equal(blob.includes("52000"), true);
    assert.equal(blob.includes("48000"), true);
    assert.equal(blob.includes("41000"), false);
    assert.equal(blob.includes("27000"), false);
    assert.equal(blob.includes("6543210"), false);
    assert.equal(blob.includes("7777771"), false);
    assert.equal(blob.includes(secrets.markers.otherYard), false);
    assert.equal(insights.yards[0].olderSales.count, 3);
    assert.equal(insights.yards[0].olderSales.medianPrice, 40000);
    assert.equal(insights.publicMarket[0].synthetic, true);
    const olderDate = new Date(DEMO_NOW.getTime() - 400 * 86_400_000).toISOString();
    assert.equal(blob.includes(olderDate), false);

    const north = await (await fetch(`${server.url}/api/carbitrage/insights`, { headers: { cookie: await login(server.url, secrets, "north") } })).text();
    assert.equal(north.includes("6543210"), false);
    const group = await (await fetch(`${server.url}/api/carbitrage/insights`, { headers: { cookie: await login(server.url, secrets, "group") } })).text();
    assert.equal(group.includes("6543210"), true);

    const mcpInsights = await mcp(server.url, secrets.users.patrick.mcpKey, "tools/call", { name: "get_insights", arguments: {} });
    assert.deepEqual(JSON.parse(textOf(mcpInsights.body)), insights);
  } finally {
    await server.close();
  }
});

test("sales import is idempotent, yard comes from the login, and demo sign-in can be disabled", async () => {
  const { secrets, server } = await boot();
  const disabled = await boot(false);
  try {
    const cookie = await login(server.url, secrets, "patrick");
    const sample = await (await fetch(`${server.url}/api/carbitrage/sales-import/sample`, { headers: { cookie } })).json();
    assert.equal(sample.adapter, "pentana_sales_csv_v1");
    assert.equal(sample.synthetic, true);
    const imported = await fetch(`${server.url}/api/carbitrage/sales-import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ csv: sample.csv, yardId: "yard_other" }),
    });
    assert.equal(imported.status, 403);
    const ok = await (await fetch(`${server.url}/api/carbitrage/sales-import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ csv: sample.csv }),
    })).json();
    assert.equal(ok.inserted, 2);
    assert.equal(ok.warnings.some((warning: string) => warning.includes("ignored")), true);
    const again = await (await fetch(`${server.url}/api/carbitrage/sales-import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ csv: sample.csv }),
    })).json();
    assert.equal(again.inserted, 0);
    assert.equal(again.deduped, 2);
    const insights = await (await fetch(`${server.url}/api/carbitrage/insights`, { headers: { cookie } })).text();
    assert.equal(insights.includes("44550"), true);
    const outsider = await (await fetch(`${server.url}/api/carbitrage/insights`, {
      headers: { cookie: await login(server.url, secrets, "outsider") },
    })).text();
    assert.equal(outsider.includes("44550"), false);

    const demoOff = await fetch(`${disabled.server.url}/api/carbitrage/session/demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "patrick" }),
    });
    assert.equal(demoOff.status, 404);
    const stillPassword = await fetch(`${disabled.server.url}/api/carbitrage/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: disabled.secrets.users.patrick.email, password: disabled.secrets.password }),
    });
    assert.equal(stillPassword.status, 200);
  } finally {
    await server.close();
    await disabled.server.close();
  }
});

test("mcp discovers the same tools as the website catalog and file reload keeps one ingest", async () => {
  const { secrets, server } = await boot();
  const dir = mkdtempSync(join(tmpdir(), "carbitrage-"));
  const file = join(dir, "store.json");
  try {
    const listed = await mcp(server.url, secrets.users.patrick.mcpKey, "tools/list", {});
    assert.equal(listed.status, 200);
    const names = listed.body.result.tools.map((tool: { name: string }) => tool.name);
    const cookie = await login(server.url, secrets, "patrick");
    const catalog = await (await fetch(`${server.url}/api/carbitrage/mcp/tools`, { headers: { cookie } })).json();
    assert.deepEqual(catalog.tools.map((tool: { name: string }) => tool.name), names);
    assert.deepEqual(names, ["list_finds", "get_find", "get_yard_profile", "get_insights", "update_find_workflow"]);
    const init = await mcp(server.url, secrets.users.patrick.mcpKey, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    assert.equal(init.body.result.serverInfo.name, "carbitrage");

    const disk = new JsonFileStore(file);
    const diskSecrets = seedDemo(disk, "demo-only", DEMO_NOW);
    const diskServer = await startCarbitrageServer({
      store: disk,
      sessionSecret: SECRET,
      demoMode: false,
      now: () => DEMO_NOW,
    });
    const payload = {
      externalId: "disk-1",
      sourceSystem: "vps_synthetic",
      sourceChannel: "private",
      sourceUrl: "https://example.invalid/synthetic/private/disk-1",
      sourceLabel: "Disk",
      capturedAt: DEMO_NOW.toISOString(),
      yardId: "yard_patrick",
      year: 2018,
      make: "Toyota",
      model: "Corolla",
      variant: null,
      variantMatch: "insufficient_evidence",
      odometerKm: 10,
      askingPrice: 1000,
      floorExGov: null,
      floorSource: null,
      floorAsOf: null,
      photoUrl: null,
      photoCredit: null,
      synthetic: true,
      envelope: { listingRef: "disk-1" },
    };
    await fetch(`${diskServer.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${diskSecrets.ingestToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await fetch(`${diskServer.url}/api/carbitrage/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${diskSecrets.ingestToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await diskServer.close();
    const reloaded = new JsonFileStore(file);
    const rows = reloaded.snapshot().opportunities.filter((row) => row.externalId === "disk-1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceEnvelope.listingRef, "disk-1");
    assert.equal(reloaded.snapshot().receipts.find((row) => row.dedupeKey.endsWith("disk-1"))?.attempts, 2);
  } finally {
    await server.close();
  }
});

test("draft sql stays out of the live migrations folder and scopes rows by membership", () => {
  const sql = readFileSync(new URL("../../supabase/drafts/20261106_carbitrage_standalone.sql", import.meta.url), "utf8");
  assert.equal(sql.toLowerCase().includes("enable row level security"), true);
  assert.equal(sql.includes("auth.uid()"), true);
  assert.equal(sql.toLowerCase().includes("drop database"), false);
  assert.equal(sql.includes("supabase.co"), false);
  const applied = readFileSync(new URL("../../supabase/migrations/20260117213422_fc2b0451-2716-4b6e-9b77-936032923101.sql", import.meta.url), "utf8");
  assert.equal(applied.includes("carbitrage_opportunities"), false);
});
