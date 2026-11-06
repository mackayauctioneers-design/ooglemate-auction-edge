/**
 * Prepare the isolated private preview. Does not open a public tunnel,
 * publish Lovable, or touch a Supabase host.
 * Prints paths and key names only.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { productionShapedKeys } from "../server/carbitrage/preview-guard.ts";

const env = { ...process.env, CARBITRAGE_ENV: "preview", CARBITRAGE_DEMO_MODE: "1" };
const hits = productionShapedKeys(env);
if (hits.length > 0) {
  console.error(`Preview refused. Unset these production-shaped variables first: ${hits.join(", ")}`);
  process.exit(1);
}

mkdirSync(".carbitrage-local", { recursive: true });
const gateFile = env.CARBITRAGE_PREVIEW_GATE_FILE || ".carbitrage-local/preview-gate";
env.CARBITRAGE_PREVIEW_GATE_FILE = gateFile;
try {
  const existing = readFileSync(gateFile, "utf8").trim();
  if (existing.length < 16) throw new Error("short");
  console.log(`Preview gate file already present at ${gateFile}`);
} catch {
  writeFileSync(gateFile, `${randomBytes(24).toString("base64url")}\n`, { mode: 0o600 });
  console.log(`Preview gate file created at ${gateFile}`);
}

if (!env.CARBITRAGE_DATABASE_URL && !exists(".carbitrage-local/database-url")) {
  console.error("Set CARBITRAGE_DATABASE_URL or .carbitrage-local/database-url to a localhost Postgres URL.");
  process.exit(1);
}
if (!env.CARBITRAGE_MIGRATE_URL && !exists(".carbitrage-local/migrate-url")) {
  console.error("Set CARBITRAGE_MIGRATE_URL or .carbitrage-local/migrate-url to a localhost Postgres URL.");
  process.exit(1);
}

const build = spawnSync("npx", ["vite", "build", "--mode", "preview"], { stdio: "inherit", env });
if (build.status !== 0) process.exit(build.status ?? 1);
const scan = spawnSync("grep", ["-R", "-l", "supabase.co", "dist"], { encoding: "utf8" });
if (scan.status === 0) {
  console.error("Preview bundle contains a Supabase host. Refusing to start.");
  process.exit(1);
}

const child = spawnSync("node", ["--experimental-strip-types", "server/carbitrage/main.ts"], { stdio: "inherit", env });
process.exit(child.status ?? 1);

function exists(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
