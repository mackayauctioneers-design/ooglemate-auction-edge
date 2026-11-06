import { readFileSync } from "node:fs";
import pg from "pg";
import { ServiceError, type Principal, type Snapshot } from "./domain.ts";
import { emptySnapshot, type DataPort } from "./store.ts";

const { Pool } = pg;

export function assertDisposableDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Database URL is not valid");
  }
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith("supabase.co") || host.endsWith("supabase.com") || host.includes("supabase")) {
    throw new Error("Refusing a linked Supabase database");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Refusing a non-local database host");
  }
}

export async function applyCanonicalSchema(connectionString: string): Promise<void> {
  assertDisposableDatabaseUrl(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const sql = readFileSync(new URL("../../supabase/drafts/20261106_carbitrage_standalone.sql", import.meta.url), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export function createPgPort(connectionString: string): DataPort & { close: () => Promise<void>; pool: pg.Pool } {
  assertDisposableDatabaseUrl(connectionString);
  const pool = new Pool({ connectionString, max: 8 });
  const port = new PgPort(pool);
  return {
    read: (principal) => port.read(principal),
    mutate: (principal, fn) => port.mutate(principal, fn),
    close: () => pool.end(),
    pool,
  };
}

class PgPort implements DataPort {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async read(principal: Principal): Promise<Snapshot> {
    return this.transaction(principal, async (client) => loadSnapshot(client, principal));
  }

  async mutate(principal: Principal, fn: (draft: Snapshot) => void): Promise<void> {
    await this.transaction(principal, async (client) => {
      const current = await loadSnapshot(client, principal);
      const draft = structuredClone(current);
      fn(draft);
      await persistDiff(client, current, draft);
    });
  }

  private async transaction<T>(principal: Principal, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await enterRole(client, principal);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}

async function enterRole(client: pg.PoolClient, principal: Principal): Promise<void> {
  if (principal.kind === "user") {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: principal.userId, role: "authenticated" }),
    ]);
    await client.query("select set_config('carbitrage.principal_id', '', true)");
    await client.query("set local role authenticated");
    return;
  }
  await client.query("select set_config('request.jwt.claims', '{}', true)");
  await client.query("select set_config('carbitrage.principal_id', $1, true)", [principal.principalId]);
  await client.query("set local role carbitrage_ingest");
}

async function loadSnapshot(client: pg.PoolClient, principal: Principal): Promise<Snapshot> {
  const snapshot = emptySnapshot();
  const role = await currentRole(client);
  if (role === "authenticated" && principal.kind === "user") {
    const profile = await client.query<{ user_id: string; email: string; display_name: string }>(
      "select user_id, email, display_name from carbitrage_profiles where user_id = auth.uid()",
    );
    snapshot.users = profile.rows.map((row) => ({
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      passwordHash: "",
      passwordSalt: "",
    }));
    const memberships = await client.query<{ user_id: string; yard_id: string; role: "dealer" | "group_admin" }>(
      "select user_id, yard_id, role from carbitrage_memberships",
    );
    snapshot.memberships = memberships.rows.map((row) => ({
      userId: row.user_id,
      yardId: row.yard_id,
      role: row.role,
    }));
    snapshot.sales = (await docs(client, "carbitrage_sales")) as Snapshot["sales"];
    snapshot.publicFacts = (await docs(client, "carbitrage_public_facts")) as Snapshot["publicFacts"];
  }
  if (role === "carbitrage_ingest" && principal.kind === "ingest") {
    const grants = await client.query<{ yard_id: string }>(
      "select yard_id from carbitrage_ingest_grants where principal_id = current_setting('carbitrage.principal_id', true)",
    );
    snapshot.ingestPrincipals = [
      {
        id: principal.principalId,
        name: "ingest",
        tokenHash: "",
        yardIds: grants.rows.map((row) => row.yard_id),
      },
    ];
    snapshot.receipts = (await docs(client, "carbitrage_ingest_receipts")) as Snapshot["receipts"];
  }
  const yards = await client.query<{
    id: string;
    name: string;
    kind: Snapshot["yards"][number]["kind"];
    group_id: string | null;
    ooglecars_yard_id: string | null;
    region: string;
    franchise: string | null;
  }>("select id, name, kind, group_id, ooglecars_yard_id, region, franchise from carbitrage_yards");
  snapshot.yards = yards.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    groupId: row.group_id,
    ooglecarsYardId: row.ooglecars_yard_id,
    region: row.region,
    franchise: row.franchise,
  }));
  snapshot.opportunities = (await docs(client, "carbitrage_opportunities")) as Snapshot["opportunities"];
  snapshot.mandates = (await docs(client, "carbitrage_mandates")) as Snapshot["mandates"];
  snapshot.alerts = (await docs(client, "carbitrage_alerts")) as Snapshot["alerts"];
  return snapshot;
}

async function docs(client: pg.PoolClient, table: string): Promise<unknown[]> {
  const result = await client.query<{ document: unknown }>(`select document from ${table}`);
  return result.rows.map((row) => row.document);
}

async function currentRole(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ current_user: string }>("select current_user");
  return result.rows[0]?.current_user ?? "";
}

async function persistDiff(client: pg.PoolClient, before: Snapshot, after: Snapshot): Promise<void> {
  await diffDocs(client, "carbitrage_opportunities", "id", before.opportunities, after.opportunities, "dedupe_key");
  await diffDocs(client, "carbitrage_sales", "id", before.sales, after.sales, null);
  await diffDocs(client, "carbitrage_mandates", "id", before.mandates, after.mandates, null);
  await diffDocs(client, "carbitrage_alerts", "id", before.alerts, after.alerts, "opportunity_kind");
  await diffReceipts(client, before.receipts, after.receipts);
  await diffKeys(client, before.apiKeys, after.apiKeys);
}

async function diffDocs(
  client: pg.PoolClient,
  table: string,
  idKey: "id",
  before: { id: string }[],
  after: { id: string }[],
  conflict: "dedupe_key" | "opportunity_kind" | null,
): Promise<void> {
  const prior = new Map(before.map((row) => [row.id, JSON.stringify(row)]));
  for (const row of after) {
    const encoded = JSON.stringify(row);
    if (!prior.has(row.id)) {
      if (conflict === "dedupe_key") {
        await client.query(
          `insert into ${table} (id, document) values ($1, $2::jsonb) on conflict (dedupe_key) do nothing`,
          [row.id, encoded],
        );
      } else if (conflict === "opportunity_kind") {
        await client.query(
          `insert into ${table} (id, document) values ($1, $2::jsonb) on conflict (opportunity_id, kind) do nothing`,
          [row.id, encoded],
        );
      } else {
        await client.query(`insert into ${table} (id, document) values ($1, $2::jsonb)`, [row.id, encoded]);
      }
    } else if (prior.get(row.id) !== encoded) {
      await client.query(`update ${table} set document = $2::jsonb where ${idKey} = $1`, [row.id, encoded]);
    }
  }
}

async function diffReceipts(client: pg.PoolClient, before: Snapshot["receipts"], after: Snapshot["receipts"]): Promise<void> {
  const prior = new Map(before.map((row) => [row.dedupeKey, JSON.stringify(row)]));
  for (const row of after) {
    const encoded = JSON.stringify(row);
    if (!prior.has(row.dedupeKey)) {
      await client.query(
        `insert into carbitrage_ingest_receipts (dedupe_key, document) values ($1, $2::jsonb)
         on conflict (dedupe_key) do update set document = jsonb_set(
           carbitrage_ingest_receipts.document,
           '{attempts}',
           to_jsonb(coalesce((carbitrage_ingest_receipts.document->>'attempts')::int, 1) + 1)
         )`,
        [row.dedupeKey, encoded],
      );
    } else if (prior.get(row.dedupeKey) !== encoded) {
      await client.query("update carbitrage_ingest_receipts set document = $2::jsonb where dedupe_key = $1", [
        row.dedupeKey,
        encoded,
      ]);
    }
  }
}

async function diffKeys(client: pg.PoolClient, before: Snapshot["apiKeys"], after: Snapshot["apiKeys"]): Promise<void> {
  const prior = new Set(before.map((row) => row.id));
  for (const row of after) {
    if (prior.has(row.id)) continue;
    await client.query(
      "insert into carbitrage_api_keys (id, user_id, token_hash, label, created_at) values ($1, $2, $3, $4, $5)",
      [row.id, row.userId, row.tokenHash, row.label, row.createdAt],
    );
  }
}

export async function seedCanonicalDatabase(connectionString: string, snapshot: Snapshot): Promise<void> {
  assertDisposableDatabaseUrl(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    for (const yard of snapshot.yards) {
      await client.query(
        `insert into carbitrage_yards (id, name, kind, group_id, ooglecars_yard_id, region, franchise)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
        [yard.id, yard.name, yard.kind, yard.groupId, yard.ooglecarsYardId, yard.region, yard.franchise],
      );
    }
    for (const user of snapshot.users) {
      await client.query(
        `insert into carbitrage_profiles (user_id, email, display_name, password_hash, password_salt)
         values ($1,$2,$3,$4,$5) on conflict (user_id) do nothing`,
        [user.id, user.email, user.displayName, user.passwordHash, user.passwordSalt],
      );
    }
    for (const membership of snapshot.memberships) {
      await client.query(
        `insert into carbitrage_memberships (user_id, yard_id, role) values ($1,$2,$3) on conflict do nothing`,
        [membership.userId, membership.yardId, membership.role],
      );
    }
    for (const principal of snapshot.ingestPrincipals) {
      await client.query(
        `insert into carbitrage_ingest_principals (id, name, token_hash) values ($1,$2,$3) on conflict (id) do nothing`,
        [principal.id, principal.name, principal.tokenHash],
      );
      for (const yardId of principal.yardIds) {
        await client.query(
          `insert into carbitrage_ingest_grants (principal_id, yard_id) values ($1,$2) on conflict do nothing`,
          [principal.id, yardId],
        );
      }
    }
    for (const fact of snapshot.publicFacts) {
      await client.query(
        `insert into carbitrage_public_facts (id, document) values ($1, $2::jsonb) on conflict (id) do nothing`,
        [fact.id, JSON.stringify(fact)],
      );
    }
    for (const row of snapshot.opportunities) {
      await client.query(
        `insert into carbitrage_opportunities (id, document) values ($1, $2::jsonb) on conflict (id) do nothing`,
        [row.id, JSON.stringify(row)],
      );
    }
    for (const row of snapshot.sales) {
      await client.query(`insert into carbitrage_sales (id, document) values ($1, $2::jsonb) on conflict (id) do nothing`, [
        row.id,
        JSON.stringify(row),
      ]);
    }
    for (const row of snapshot.mandates) {
      await client.query(
        `insert into carbitrage_mandates (id, document) values ($1, $2::jsonb) on conflict (id) do nothing`,
        [row.id, JSON.stringify(row)],
      );
    }
    for (const row of snapshot.alerts) {
      await client.query(`insert into carbitrage_alerts (id, document) values ($1, $2::jsonb) on conflict (id) do nothing`, [
        row.id,
        JSON.stringify(row),
      ]);
    }
    for (const row of snapshot.apiKeys) {
      await client.query(
        `insert into carbitrage_api_keys (id, user_id, token_hash, label, created_at) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
        [row.id, row.userId, row.tokenHash, row.label, row.createdAt],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}

function mapPgError(err: unknown): unknown {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: string }).code);
    if (code === "42501") {
      return new ServiceError(403, "yard_forbidden", "The database rejected that tenant write");
    }
  }
  return err;
}

export async function lookupIngestPrincipal(pool: pg.Pool, tokenHash: string): Promise<{ principalId: string; yardIds: string[] } | null> {
  const result = await pool.query<{ principal_id: string; yard_id: string }>(
    "select principal_id, yard_id from carbitrage_lookup_ingest($1)",
    [tokenHash],
  );
  if (result.rows.length === 0) return null;
  return { principalId: result.rows[0].principal_id, yardIds: result.rows.map((row) => row.yard_id) };
}

export async function lookupApiKeyUser(pool: pg.Pool, tokenHash: string): Promise<string | null> {
  const result = await pool.query<{ carbitrage_lookup_api_key: string | null }>(
    "select carbitrage_lookup_api_key($1)",
    [tokenHash],
  );
  return result.rows[0]?.carbitrage_lookup_api_key ?? null;
}

export async function lookupDemoPassword(
  pool: pg.Pool,
  email: string,
): Promise<{ userId: string; passwordHash: string; passwordSalt: string; displayName: string } | null> {
  const result = await pool.query<{ user_id: string; password_hash: string | null; password_salt: string | null; display_name: string }>(
    "select user_id, password_hash, password_salt, display_name from carbitrage_demo_password($1)",
    [email],
  );
  const row = result.rows[0];
  if (!row?.password_hash || !row.password_salt) return null;
  return { userId: row.user_id, passwordHash: row.password_hash, passwordSalt: row.password_salt, displayName: row.display_name };
}
