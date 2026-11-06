import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEMO_NOW } from "./domain.ts";
import { seedDemo } from "./fixtures.ts";
import { startCarbitrageServer } from "./http.ts";
import { JsonFileStore } from "./store.ts";

const demoMode = process.env.CARBITRAGE_DEMO_MODE === "1";
const dataFile = process.env.CARBITRAGE_DATA_FILE ?? ".carbitrage-local/store.json";
const port = Number(process.env.CARBITRAGE_PORT ?? 8787);
const host = process.env.CARBITRAGE_HOST ?? "127.0.0.1";

const secret = loadSecret();
const store = new JsonFileStore(dataFile);

if (demoMode && store.snapshot().users.length === 0) {
  const password = process.env.CARBITRAGE_DEMO_PASSWORD ?? "demo-only";
  const seeded = seedDemo(store, password, DEMO_NOW);
  if (process.env.CARBITRAGE_WRITE_LOCAL_SECRETS === "1") {
    const secretFile = ".carbitrage-local/ingest-token";
    mkdirSync(dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, seeded.ingestToken, { mode: 0o600 });
    console.log("Ingest token written to .carbitrage-local/ingest-token");
  }
  console.log("Seeded synthetic demo yards. Password login uses CARBITRAGE_DEMO_PASSWORD (local default demo-only).");
}

const server = await startCarbitrageServer(
  { store, sessionSecret: secret, demoMode, now: () => DEMO_NOW },
  port,
  host,
);
console.log(`Carbitrage local API ${server.url} demoMode=${demoMode} billingEnabled=false`);

function loadSecret(): string {
  if (process.env.CARBITRAGE_SESSION_SECRET) return process.env.CARBITRAGE_SESSION_SECRET;
  const file = ".carbitrage-local/session-secret";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const created = randomBytes(32).toString("hex");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, created, { mode: 0o600 });
    return created;
  }
}
