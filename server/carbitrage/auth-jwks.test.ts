import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createJwksVerifier } from "./auth.ts";

const ISS = "https://example.invalid/auth/v1";
const NOW = new Date("2026-11-20T03:00:00Z");
const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" };

function sign(payload: Record<string, unknown>, key = pair.privateKey, kid = "k1", alg = "ES256"): string {
  const h = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = createSign("sha256").update(`${h}.${p}`).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${s}`;
}
const good = { sub: "u1", iss: ISS, aud: "authenticated", exp: Math.floor(NOW.getTime() / 1000) + 600 };
let fetches = 0;
const verifier = createJwksVerifier({ jwksUrl: "https://example.invalid/jwks", issuer: ISS, fetchImpl: (async () => { fetches++; return new Response(JSON.stringify({ keys: [jwk] })); }) as typeof fetch });

test("a valid ES256 Supabase token is accepted and the keys are cached", async () => {
  assert.equal((await verifier.verify(sign(good), NOW))?.sub, "u1");
  await verifier.verify(sign(good), NOW);
  assert.equal(fetches, 1);
});

test("forged, expired, wrong issuer, wrong audience and wrong algorithm are all refused", async () => {
  assert.equal(await verifier.verify(sign(good, other.privateKey), NOW), null);
  assert.equal(await verifier.verify(sign({ ...good, exp: 1 }), NOW), null);
  assert.equal(await verifier.verify(sign({ ...good, iss: "https://evil.invalid/auth/v1" }), NOW), null);
  assert.equal(await verifier.verify(sign({ ...good, aud: "anon" }), NOW), null);
  assert.equal(await verifier.verify(sign({ ...good, sub: undefined }), NOW), null);
  assert.equal(await verifier.verify(sign(good, pair.privateKey, "k1", "HS256"), NOW), null);
  assert.equal(await verifier.verify(sign(good, pair.privateKey, "unknown-kid"), NOW), null);
  assert.equal(await verifier.verify("not.a.jwt", NOW), null);
  assert.equal(await verifier.verify("abc", NOW), null);
});
