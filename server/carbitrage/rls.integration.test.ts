import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { resolveRuntimeFlags } from "./auth.ts";
import { DEMO_NOW } from "./domain.ts";
import { seedDemo } from "./fixtures.ts";
import { startCarbitrageServer, type AuthDirectory } from "./http.ts";
import { applyCanonicalSchema, createPgPort, lookupApiKeyUser, lookupDemoPassword, lookupIngestPrincipal, seedCanonicalDatabase } from "./pg-port.ts";
import { MemoryStore } from "./store.ts";

const migratorPassword = randomBytes(18).toString("hex");
const appPassword = randomBytes(18).toString("hex");
const jwtSecret = randomBytes(24).toString("hex");
const dbName = `carbitrage_disp_${process.pid}`;
const migratorUrl = `postgresql://carbitrage_migrator:${encodeURIComponent(migratorPassword)}@127.0.0.1:5432/${dbName}`;
const appUrl = `postgresql://carbitrage_app:${encodeURIComponent(appPassword)}@127.0.0.1:5432/${dbName}`;

function psql(sql: string, database = "postgres"): void {
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

let server: Awaited<ReturnType<typeof startCarbitrageServer>>;
let lockedDown: Awaited<ReturnType<typeof startCarbitrageServer>>;
let app: ReturnType<typeof createPgPort>;
let admin: pg.Client;
let secrets: ReturnType<typeof seedDemo>;

before(async () => {
  psql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'carbitrage_migrator') then
        create role carbitrage_migrator login superuser password '${migratorPassword}';
      else
        alter role carbitrage_migrator with login superuser password '${migratorPassword}';
      end if;
    end $$;
  `);
  psql(`drop database if exists ${dbName}`);
  psql(`create database ${dbName}`);
  await applyCanonicalSchema(migratorUrl);
  psql(`alter role carbitrage_app with login password '${appPassword}'`);
  const memory = new MemoryStore();
  secrets = seedDemo(memory, "demo-only", DEMO_NOW);
  await seedCanonicalDatabase(migratorUrl, memory.snapshot());
  admin = new pg.Client({ connectionString: migratorUrl });
  await admin.connect();
  app = createPgPort(appUrl);
  const directory: AuthDirectory = {
    demoPassword: (email) => lookupDemoPassword(app.pool, email),
    apiKeyUser: (hash) => lookupApiKeyUser(app.pool, hash),
    ingestPrincipal: async (hash) => (await lookupIngestPrincipal(app.pool, hash))?.principalId ?? null,
  };
  const shared = {
    data: app,
    directory,
    sessionSecret: "rls-test-secret",
    jwtSecret,
    oauthIssuer: "https://example.invalid/auth",
    oauthResourceUrl: "http://127.0.0.1:9/mcp",
    persistence: "postgres" as const,
    now: () => DEMO_NOW,
  };
  server = await startCarbitrageServer({ ...shared, demoMode: true });
  lockedDown = await startCarbitrageServer({ ...shared, demoMode: false, oauthIssuer: null, oauthResourceUrl: null });
});

after(async () => {
  await server?.close();
  await lockedDown?.close();
  await app?.close();
  await admin?.end();
  psql(`drop database if exists ${dbName} with (force)`);
});

function cookieFrom(res: Response): string {
  const line = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
  assert.ok(line, "expected a session cookie");
  return line.split(";")[0];
}

async function login(persona: "patrick" | "north" | "group" | "titled" | "outsider"): Promise<string> {
  const res = await fetch(`${server.url}/api/carbitrage/session/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  assert.equal(res.status, 200);
  return cookieFrom(res);
}

function signJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(DEMO_NOW.getTime() / 1000) + 3600, role: "authenticated" })).toString("base64url");
  const signature = createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

test("demo flags fail closed unless the local environment is explicit", () => {
  assert.equal(resolveRuntimeFlags({}).demoMode, false);
  assert.equal(resolveRuntimeFlags({ CARBITRAGE_DEMO_MODE: "1" }).demoMode, false);
  assert.equal(resolveRuntimeFlags({ CARBITRAGE_DEMO_MODE: "1", CARBITRAGE_ENV: "production" }).demoMode, false);
  assert.equal(resolveRuntimeFlags({ CARBITRAGE_DEMO_MODE: "1", CARBITRAGE_ENV: "local" }).demoMode, true);
});

test("grants and RLS deny anonymous, cross-yard, title-only and forged membership", async () => {
  const privileges = await admin.query<{
    anon_select: boolean;
    auth_insert: boolean;
    auth_update: boolean;
    auth_membership_insert: boolean;
  }>(`
    select
      has_table_privilege('anon', 'carbitrage_opportunities', 'select') as anon_select,
      has_table_privilege('authenticated', 'carbitrage_opportunities', 'insert') as auth_insert,
      has_table_privilege('authenticated', 'carbitrage_opportunities', 'update') as auth_update,
      has_table_privilege('authenticated', 'carbitrage_memberships', 'insert') as auth_membership_insert
  `);
  assert.equal(privileges.rows[0].anon_select, false);
  assert.equal(privileges.rows[0].auth_insert, false);
  assert.equal(privileges.rows[0].auth_update, true);
  assert.equal(privileges.rows[0].auth_membership_insert, false);

  const bare = new pg.Client({ connectionString: appUrl });
  await bare.connect();
  await assert.rejects(() => bare.query("select * from carbitrage_opportunities"));
  await bare.end();

  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    await assert.rejects(() => client.query("select * from carbitrage_opportunities"));
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: secrets.users.patrick.userId }),
    ]);
    await client.query("set local role authenticated");
    const own = await client.query<{ yard: string }>("select document->>'yardId' as yard from carbitrage_opportunities");
    assert.ok(own.rows.length > 0);
    assert.ok(own.rows.every((row) => row.yard === "yard_patrick"));
    await assert.rejects(() =>
      client.query("insert into carbitrage_memberships (user_id, yard_id, role) values ($1, 'yard_other', 'dealer')", [
        secrets.users.patrick.userId,
      ]),
    );
    await client.query("rollback");
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: secrets.users.patrick.userId }),
    ]);
    await client.query("set local role authenticated");
    const forged = await client.query("update carbitrage_opportunities set document = document where yard_id = 'yard_other'");
    assert.equal(forged.rowCount, 0);
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: secrets.users.titled.userId })]);
    await client.query("set local role authenticated");
    const titled = await client.query<{ yard: string }>("select distinct document->>'yardId' as yard from carbitrage_opportunities");
    assert.deepEqual(titled.rows.map((row) => row.yard), ["yard_ktmg_north"]);
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: secrets.users.group.userId })]);
    await client.query("set local role authenticated");
    const group = await client.query<{ yard: string }>("select distinct document->>'yardId' as yard from carbitrage_opportunities order by 1");
    assert.deepEqual(group.rows.map((row) => row.yard), ["yard_ktmg_north", "yard_ktmg_south"]);
    await client.query("rollback");
  } finally {
    await client.end();
  }
});

test("website, mcp and ingest share one postgres row across a server restart", async () => {
  const patrick = await login("patrick");
  const payload = {
    externalId: "pg-restart-1",
    sourceSystem: "vps_synthetic",
    sourceChannel: "auction",
    sourceUrl: "https://example.invalid/synthetic/auction/pg-restart-1",
    sourceLabel: "Restart fixture",
    capturedAt: "2026-11-05T00:00:00.000Z",
    yardId: "yard_patrick",
    year: 2020,
    make: "Toyota",
    model: "Hilux",
    variant: "E",
    variantMatch: "matched",
    odometerKm: 10,
    askingPrice: 33333,
    floorExGov: 99999,
    floorSource: "Patrick Auto own sales, last 6 months",
    floorAsOf: "2026-11-01",
    photoUrl: null,
    photoCredit: null,
    synthetic: true,
    envelope: { listingRef: "pg-restart-1" },
  };
  const headers = { authorization: `Bearer ${secrets.ingestToken}`, "content-type": "application/json" };
  const [first, second] = await Promise.all([
    fetch(`${server.url}/api/carbitrage/ingest`, { method: "POST", headers, body: JSON.stringify(payload) }),
    fetch(`${server.url}/api/carbitrage/ingest`, { method: "POST", headers, body: JSON.stringify({ ...payload, askingPrice: 1 }) }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const stored = await admin.query<{ n: string; attempts: string; price: string }>(
    `select count(*)::text as n,
            max(r.document->>'attempts') as attempts,
            max(o.document->>'askingPrice') as price
     from carbitrage_opportunities o
     join carbitrage_ingest_receipts r on r.dedupe_key = o.dedupe_key
     where o.document->>'externalId' = 'pg-restart-1'`,
  );
  assert.equal(stored.rows[0].n, "1");
  assert.equal(Number(stored.rows[0].attempts) >= 2, true);
  assert.equal(stored.rows[0].price, "33333");

  const created = await first.json();
  const before = await (await fetch(`${server.url}/api/carbitrage/finds/${created.opportunityId}`, {
    headers: { cookie: patrick },
  })).json();
  await server.close();
  const restartedPort = createPgPort(appUrl);
  let restarted: Awaited<ReturnType<typeof startCarbitrageServer>> | null = null;
  restarted = await startCarbitrageServer({
    data: restartedPort,
    directory: {
      demoPassword: (email) => lookupDemoPassword(restartedPort.pool, email),
      apiKeyUser: (hash) => lookupApiKeyUser(restartedPort.pool, hash),
      ingestPrincipal: async (hash) => (await lookupIngestPrincipal(restartedPort.pool, hash))?.principalId ?? null,
    },
    sessionSecret: "rls-test-secret",
    demoMode: true,
    jwtSecret,
    oauthIssuer: null,
    oauthResourceUrl: null,
    persistence: "postgres",
    now: () => DEMO_NOW,
  });
  try {
    if (!restarted) throw new Error("restart failed");
    const againPatrick = await fetch(`${restarted.url}/api/carbitrage/session/demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "patrick" }),
    });
    const cookie = cookieFrom(againPatrick);
    const httpFind = await (await fetch(`${restarted.url}/api/carbitrage/finds/${before.id}`, { headers: { cookie } })).json();
    const mcp = await fetch(`${restarted.url}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${secrets.users.patrick.mcpKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_find", arguments: { id: before.id } },
      }),
    });
    const mcpBody = await mcp.json();
    assert.deepEqual(JSON.parse(mcpBody.result.content[0].text), httpFind);
    assert.equal(httpFind.askingPrice, 33333);
    assert.equal(httpFind.sourceEnvelope.listingRef, "pg-restart-1");
    assert.equal(httpFind.floorExGov, 52000);
    assert.equal(String(httpFind.floorSource).includes("Hilux E"), true);
  } finally {
    await restarted?.close();
    await restartedPort.close();
    server = await startCarbitrageServer({
      data: app,
      directory: {
        demoPassword: (email) => lookupDemoPassword(app.pool, email),
        apiKeyUser: (hash) => lookupApiKeyUser(app.pool, hash),
        ingestPrincipal: async (hash) => (await lookupIngestPrincipal(app.pool, hash))?.principalId ?? null,
      },
      sessionSecret: "rls-test-secret",
      demoMode: true,
      jwtSecret,
      oauthIssuer: "https://example.invalid/auth",
      oauthResourceUrl: "http://127.0.0.1:9/mcp",
      persistence: "postgres",
      now: () => DEMO_NOW,
    });
  }
});

test("triton floor is not attributed to sales that do not exist", async () => {
  const cookie = await login("patrick");
  const detailResponse = await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-aged-triton`, { headers: { cookie } });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.floorExGov, null);
  assert.equal(detail.floorSource, null);
  assert.equal(detail.underFloorPct, null);
  assert.equal(JSON.stringify(detail).includes("Patrick Auto own sales"), false);
  assert.equal(detail.photoUse, "illustrative");
  assert.equal(detail.photoCaption, "Illustrative photo, not the listed vehicle.");
  assert.equal(detail.listingPhotoUrl ?? null, null);
  const hilux = await (await fetch(`${server.url}/api/carbitrage/finds/opp_syn-patrick-auction-hilux`, { headers: { cookie } })).json();
  assert.equal(hilux.floorExGov, 52000);
  assert.equal(hilux.comparables.recent.some((sale: { price: number }) => sale.price === 52000), true);
  assert.equal(hilux.comparables.recent.some((sale: { price: number }) => sale.price === 40000), false);
});

test("membership removal and production auth boundaries", async () => {
  const cookie = await login("patrick");
  await admin.query("delete from carbitrage_memberships where user_id = $1", [secrets.users.patrick.userId]);
  const denied = await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie } });
  assert.equal(denied.status, 403);
  await admin.query("insert into carbitrage_memberships (user_id, yard_id, role) values ($1, 'yard_patrick', 'dealer')", [
    secrets.users.patrick.userId,
  ]);
  const restored = await fetch(`${server.url}/api/carbitrage/finds`, { headers: { cookie } });
  assert.equal(restored.status, 200);

  const persona = await fetch(`${lockedDown.url}/api/carbitrage/session/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona: "patrick" }),
  });
  assert.equal(persona.status, 404);
  const password = await fetch(`${lockedDown.url}/api/carbitrage/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: secrets.users.patrick.email, password: "demo-only" }),
  });
  assert.equal(password.status, 404);
  const demoKey = await fetch(`${lockedDown.url}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${secrets.users.patrick.mcpKey}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(demoKey.status, 401);
  const missing = await fetch(`${lockedDown.url}/.well-known/oauth-protected-resource`);
  const missingBody = await missing.json();
  assert.equal(missing.status, 404);
  assert.equal(missingBody.configured, false);

  const jwt = signJwt(secrets.users.patrick.userId);
  const session = await fetch(`${lockedDown.url}/api/carbitrage/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken: jwt }),
  });
  assert.equal(session.status, 200);
  const jwtCookie = cookieFrom(session);
  const finds = await fetch(`${lockedDown.url}/api/carbitrage/finds`, { headers: { cookie: jwtCookie } });
  assert.equal(finds.status, 200);
  const forged = await fetch(`${lockedDown.url}/api/carbitrage/finds?yardId=yard_other`, { headers: { cookie: jwtCookie } });
  assert.equal(forged.status, 403);
  const badJwt = await fetch(`${lockedDown.url}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer not-a-jwt", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(badJwt.status, 401);

  const discovery = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
  const metadata = await discovery.json();
  assert.equal(discovery.status, 200);
  assert.deepEqual(metadata.authorization_servers, ["https://example.invalid/auth"]);
  const unauth = await fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});
