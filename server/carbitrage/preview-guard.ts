import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const SUPABASE_HOST = /supabase\.(co|com)|pooler\.supabase/i;
const PREVIEW_COOKIE = "cb_preview";

/** Key names whose non-empty values make a preview start illegal. Values are never returned. */
const PRODUCTION_KEY = /^(SUPABASE_|VITE_SUPABASE_|DATABASE_URL$)/;

export function productionShapedKeys(env: Record<string, string | undefined>): string[] {
  const hits = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    if (SUPABASE_HOST.test(value) || PRODUCTION_KEY.test(key)) hits.add(key);
  }
  return [...hits].sort();
}

/**
 * Preview mode refuses to boot when production Supabase URLs, keys, or
 * database targets are present. It also requires a gate secret file.
 * The error names keys only.
 */
export function assertPreviewIsolated(env: Record<string, string | undefined>): void {
  if (env.CARBITRAGE_ENV !== "preview") return;
  const hits = productionShapedKeys(env);
  if (hits.length > 0) {
    throw new Error(`Preview refused. Production-shaped configuration is set: ${hits.join(", ")}`);
  }
  if (!env.CARBITRAGE_PREVIEW_GATE_FILE?.trim()) {
    throw new Error("Preview refused. CARBITRAGE_PREVIEW_GATE_FILE is required.");
  }
}

export function loadPreviewGateSecret(filePath: string): string {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new Error("Preview refused. The gate secret file could not be read.");
  }
  const secret = raw.trim();
  if (secret.length < 16) {
    throw new Error("Preview refused. The gate secret file is too short.");
  }
  return secret;
}

export function previewGateToken(secret: string): string {
  return createHmac("sha256", secret).update("carbitrage-preview-gate").digest("base64url");
}

export function previewGateCookie(secret: string): string {
  return `${PREVIEW_COOKIE}=${previewGateToken(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;
}

export function previewGateAllows(cookieHeader: string | undefined, secret: string): boolean {
  if (!cookieHeader) return false;
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PREVIEW_COOKIE}=`))
    ?.slice(PREVIEW_COOKIE.length + 1);
  if (!token) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(previewGateToken(secret));
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function previewPasswordMatches(provided: string, secret: string): boolean {
  const actual = createHash("sha256").update(provided).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(actual, expected);
}

export function previewGatePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Private preview | Carbitrage</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fff; color: #111; }
    header { background: #0a0a0a; color: #fff; padding: 14px 20px; font-weight: 600; }
    main { max-width: 420px; margin: 48px auto; padding: 0 16px; }
    p { color: #444; font-size: 14px; }
    label { display: block; font-size: 14px; margin-top: 16px; }
    input { width: 100%; box-sizing: border-box; height: 44px; margin-top: 6px; border: 1px solid #ccc; padding: 0 10px; }
    button { margin-top: 16px; height: 44px; width: 100%; background: #111; color: #fff; border: 0; }
  </style>
</head>
<body>
  <header>Carbitrage</header>
  <main>
    <h1>Private preview</h1>
    <p>Synthetic test data only. This gate is the access control. A shared link without the password is not enough.</p>
    <form method="post" action="/api/carbitrage/preview-gate">
      <label for="password">Preview password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`;
}
