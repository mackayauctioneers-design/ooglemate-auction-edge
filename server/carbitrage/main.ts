import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { DEMO_NOW } from "./domain.ts";
import { resolveRuntimeFlags } from "./auth.ts";
import { assertPreviewIsolated, loadPreviewGateSecret } from "./preview-guard.ts";
import { seedDemo } from "./fixtures.ts";
import { startCarbitrageServer, type AuthDirectory } from "./http.ts";
import { applyCanonicalSchema, applyWholesaleMirror, assertDisposableDatabaseUrl, createPgPort, lookupApiKeyUser, lookupDemoPassword, lookupIngestPrincipal, seedCanonicalDatabase } from "./pg-port.ts";
import { MemoryStore } from "./store.ts";
import { createWholesale } from "./wholesale.ts";

const flags = resolveRuntimeFlags(process.env);
const databaseUrl = process.env.CARBITRAGE_DATABASE_URL?.trim() || readLocal("database-url");
const migrateUrl = process.env.CARBITRAGE_MIGRATE_URL?.trim() || readLocal("migrate-url") || databaseUrl;
if (!databaseUrl || !migrateUrl) {
  console.error("CARBITRAGE_DATABASE_URL is required and must point at a local disposable Postgres.");
  process.exit(1);
}
assertDisposableDatabaseUrl(databaseUrl);
assertDisposableDatabaseUrl(migrateUrl);
if (flags.preview) assertPreviewIsolated(process.env);
const previewGate = flags.preview ? { secret: loadPreviewGateSecret(process.env.CARBITRAGE_PREVIEW_GATE_FILE ?? "") } : null;

await applyCanonicalSchema(migrateUrl);
if (flags.preview) await applyWholesaleMirror(migrateUrl);
const admin = new pg.Client({ connectionString: migrateUrl });
await admin.connect();
if (flags.demoMode) {
  const existing = await admin.query<{ n: number }>("select count(*)::int as n from carbitrage_profiles");
  if ((existing.rows[0]?.n ?? 0) === 0) {
    const memory = new MemoryStore();
    const password = process.env.CARBITRAGE_DEMO_PASSWORD ?? "demo-only";
    seedDemo(memory, password, DEMO_NOW);
    await seedCanonicalDatabase(migrateUrl, memory.snapshot());
    console.log("Seeded synthetic rows into the local database.");
  }
}
await admin.end();
const port = createPgPort(databaseUrl);
// Preview only: the franchise wholesale mirror lives in the same disposable local database. The only outbound call is an
// optional read-only GET to the Carbitrage Market API, and only when both settings below are present.
const marketUrl = process.env.CARBITRAGE_MARKET_API_URL?.trim();
const marketKeyFile = process.env.CARBITRAGE_MARKET_API_KEY_FILE?.trim();
const market = marketUrl && marketKeyFile ? { baseUrl: marketUrl, keyFile: marketKeyFile, cacheFile: process.env.CARBITRAGE_MARKET_API_CACHE_FILE?.trim() || undefined, cacheOnly: process.env.CARBITRAGE_MARKET_API_CACHE_ONLY === "1" } : null;
const PREVIEW_DEALER_USER = "00000000-0000-4000-8000-0000000d0001";
let wholesale: ReturnType<typeof createWholesale> | null = null;
let wholesaleUser: ((userId: string) => Promise<string>) | null = null;
if (flags.preview) {
  wholesale = createWholesale({ pool: new pg.Pool({ connectionString: migrateUrl, max: 4 }), market, now: () => new Date(), preview: true });
  // Preview sign-in: only the Patrick Auto persona is the preview dealer. Any other persona is a different, non-member user.
  wholesaleUser = async (userId) => {
    const snap = await port.read({ kind: "user", userId });
    const email = snap.users.find((u) => u.id === userId)?.email?.toLowerCase();
    return email === "patrick@demo.carbitrage.test" ? PREVIEW_DEALER_USER : userId;
  };
} else if (process.env.CARBITRAGE_WHOLESALE_DATABASE_URL) {
  // Go-live wiring, NOT enabled anywhere yet. Needs the pending migrations applied, a service-role connection string and the
  // Supabase JWT secret. Callers are identified only by their verified Supabase sign-in.
  if (process.env.CARBITRAGE_WHOLESALE_GO_LIVE !== "1" || !flags.jwtSecret) {
    throw new Error("CARBITRAGE_WHOLESALE_DATABASE_URL needs CARBITRAGE_WHOLESALE_GO_LIVE=1 and SUPABASE_JWT_SECRET");
  }
  wholesale = createWholesale({ pool: new pg.Pool({ connectionString: process.env.CARBITRAGE_WHOLESALE_DATABASE_URL, max: 4, ssl: { rejectUnauthorized: false } }), market, now: () => new Date(), preview: false });
}

const directory: AuthDirectory = {
  async demoPassword(email) {
    return lookupDemoPassword(port.pool, email);
  },
  async apiKeyUser(tokenHash) {
    return lookupApiKeyUser(port.pool, tokenHash);
  },
  async ingestPrincipal(tokenHash) {
    const found = await lookupIngestPrincipal(port.pool, tokenHash);
    return found?.principalId ?? null;
  },
};

const server = await startCarbitrageServer(
  {
    data: port,
    directory,
    sessionSecret: loadSecret(),
    demoMode: flags.demoMode,
    jwtSecret: flags.jwtSecret,
    oauthIssuer: flags.oauthIssuer,
    oauthResourceUrl: flags.oauthResourceUrl,
    persistence: "postgres",
    now: () => DEMO_NOW,
    previewGate,
    wholesale,
    wholesaleUser,
    staticRoot: flags.preview ? (process.env.CARBITRAGE_STATIC_ROOT ?? "dist") : null,
  },
  Number(process.env.CARBITRAGE_PORT ?? 8787),
  process.env.CARBITRAGE_HOST ?? "127.0.0.1",
);
console.log(`Carbitrage local API ${server.url} demoMode=${flags.demoMode} persistence=postgres billingEnabled=false`);

function readLocal(name: string): string | undefined {
  try {
    return readFileSync(`.carbitrage-local/${name}`, "utf8").trim();
  } catch {
    return undefined;
  }
}

function loadSecret(): string {
  if (process.env.CARBITRAGE_SESSION_SECRET) return process.env.CARBITRAGE_SESSION_SECRET;
  const file = ".carbitrage-local/session-secret";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const created = randomBytes(32).toString("hex");
    mkdirSync(".carbitrage-local", { recursive: true });
    writeFileSync(file, created, { mode: 0o600 });
    return created;
  }
}
