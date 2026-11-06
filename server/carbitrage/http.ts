import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sha256, verifyPassword, SESSION_COOKIE, clearSessionCookie, readCookie, readSession, sessionCookie, signSession, verifySupabaseJwt } from "./auth.ts";
import { ServiceError, type Principal, type Store } from "./domain.ts";
import { PERSONAS, type Persona } from "./fixtures.ts";
import { handleMcp, toolCatalog } from "./mcp.ts";
import { createServices, type IngestBody } from "./services.ts";
import type { DataPort } from "./store.ts";

export interface AuthDirectory {
  demoPassword(email: string): Promise<{ userId: string; passwordHash: string; passwordSalt: string; displayName: string } | null>;
  apiKeyUser(tokenHash: string): Promise<string | null>;
  ingestPrincipal(tokenHash: string): Promise<string | null>;
}

export interface ServerOptions {
  data: DataPort;
  directory: AuthDirectory;
  sessionSecret: string;
  demoMode: boolean;
  jwtSecret: string | null;
  oauthIssuer: string | null;
  oauthResourceUrl: string | null;
  persistence: "postgres" | "memory";
  now: () => Date;
}

export function memoryDirectory(store: Store): AuthDirectory {
  return {
    async demoPassword(email: string) {
      const user = store.snapshot().users.find((row) => row.email.toLowerCase() === email.toLowerCase());
      if (!user) return null;
      return {
        userId: user.id,
        passwordHash: user.passwordHash,
        passwordSalt: user.passwordSalt,
        displayName: user.displayName,
      };
    },
    async apiKeyUser(tokenHash: string) {
      return store.snapshot().apiKeys.find((row) => row.tokenHash === tokenHash)?.userId ?? null;
    },
    async ingestPrincipal(tokenHash: string) {
      return store.snapshot().ingestPrincipals.find((row) => row.tokenHash === tokenHash)?.id ?? null;
    },
  };
}

export function startCarbitrageServer(opts: ServerOptions, port = 0, host = "127.0.0.1") {
  const server = createServer((req, res) => {
    void handleRequest(opts, req, res);
  });
  return new Promise<{ url: string; port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://${host}:${bound}`,
        port: bound,
        close: () => new Promise((done, reject) => server.close((err) => (err ? reject(err) : done()))),
      });
    });
  });
}

async function handleRequest(opts: ServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const services = createServices(opts.data, opts.now);
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/carbitrage/health") {
      return send(res, 200, {
        ok: true,
        product: "carbitrage",
        demoMode: opts.demoMode,
        billingEnabled: false,
        persistence: opts.persistence,
        hostedOauth: Boolean(opts.oauthIssuer && opts.oauthResourceUrl),
      });
    }

    if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
      if (!opts.oauthIssuer || !opts.oauthResourceUrl) {
        return send(res, 404, {
          configured: false,
          missing: ["CARBITRAGE_OAUTH_ISSUER", "CARBITRAGE_OAUTH_RESOURCE_URL"],
          note: "Hosted ChatGPT, Claude and Grok OAuth is not registered. A local bearer smoke test is not that integration.",
        });
      }
      return send(res, 200, {
        resource: opts.oauthResourceUrl,
        authorization_servers: [opts.oauthIssuer],
        bearer_methods_supported: ["header"],
        scopes_supported: ["carbitrage:read", "carbitrage:workflow"],
        configured: true,
      });
    }

    if (req.method === "POST" && path === "/api/carbitrage/session") {
      const body = await readJson(req);
      if ("userId" in body || "yardId" in body || "memberships" in body) {
        throw new ServiceError(400, "invalid_payload", "Membership claims are not accepted from the client");
      }
      if (typeof body.accessToken === "string") {
        if (!opts.jwtSecret) throw new ServiceError(503, "auth_not_configured", "SUPABASE_JWT_SECRET is not set");
        const claims = verifySupabaseJwt(body.accessToken, opts.jwtSecret, opts.now());
        if (!claims) throw new ServiceError(401, "unauthenticated", "Access token was rejected");
        res.setHeader("Set-Cookie", sessionCookie(signSession(claims.sub, opts.sessionSecret, opts.now())));
        return send(res, 200, { ok: true, auth: "supabase_jwt" });
      }
      if (!opts.demoMode) throw new ServiceError(404, "demo_disabled", "Password sign-in is disabled outside the local demo");
      const email = stringField(body, "email");
      const password = stringField(body, "password");
      const user = await opts.directory.demoPassword(email);
      if (!user || !verifyPassword(password, { id: user.userId, email, displayName: user.displayName, passwordHash: user.passwordHash, passwordSalt: user.passwordSalt })) {
        throw new ServiceError(401, "unauthenticated", "Email or password is incorrect");
      }
      res.setHeader("Set-Cookie", sessionCookie(signSession(user.userId, opts.sessionSecret, opts.now())));
      return send(res, 200, { ok: true, displayName: user.displayName, auth: "local_demo" });
    }

    if (req.method === "POST" && path === "/api/carbitrage/session/demo") {
      if (!opts.demoMode) throw new ServiceError(404, "demo_disabled", "Demo sign-in is disabled");
      const body = await readJson(req);
      const persona = stringField(body, "persona");
      if (!(PERSONAS as readonly string[]).includes(persona)) {
        throw new ServiceError(400, "invalid_payload", "Unknown demo persona");
      }
      const email = personaEmail(persona as Persona);
      const user = await opts.directory.demoPassword(email);
      if (!user) throw new ServiceError(404, "demo_disabled", "Demo user is not seeded");
      res.setHeader("Set-Cookie", sessionCookie(signSession(user.userId, opts.sessionSecret, opts.now())));
      return send(res, 200, { ok: true, displayName: user.displayName, email, auth: "local_demo" });
    }

    if (req.method === "DELETE" && path === "/api/carbitrage/session") {
      res.setHeader("Set-Cookie", clearSessionCookie());
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/mcp") {
      const principal = await bearerPrincipal(opts, req, "user");
      const body = await readBody(req);
      const result = await handleMcp(services, principal, body);
      if (result.body == null) {
        res.writeHead(result.status);
        res.end();
        return;
      }
      return send(res, result.status, result.body);
    }

    if (req.method === "POST" && path === "/api/carbitrage/ingest") {
      const principal = await bearerPrincipal(opts, req, "ingest");
      const result = await services.ingest(principal, asIngest(await readJson(req)));
      return send(res, 200, result);
    }

    const user = await userPrincipal(opts, req);

    if (req.method === "GET" && path === "/api/carbitrage/me") return send(res, 200, await services.me(user));
    if (req.method === "GET" && path === "/api/carbitrage/finds") {
      return send(res, 200, { finds: await services.listFinds(user, parseFindQuery(url)) });
    }
    if (req.method === "GET" && path === "/api/carbitrage/profile") {
      return send(res, 200, { profiles: await services.profiles(user, url.searchParams.get("yardId") ?? undefined) });
    }
    if (req.method === "GET" && path === "/api/carbitrage/insights") {
      return send(res, 200, await services.insights(user, url.searchParams.get("yardId") ?? undefined));
    }
    if (req.method === "GET" && path === "/api/carbitrage/alerts") return send(res, 200, { alerts: await services.listAlerts(user) });
    if (req.method === "GET" && path === "/api/carbitrage/sales-import/sample") {
      return send(res, 200, services.sampleSalesCsv());
    }
    if (req.method === "GET" && path === "/api/carbitrage/mcp/tools") {
      return send(res, 200, { tools: toolCatalog(), protocol: "mcp-jsonrpc", auth: "bearer" });
    }

    const findMatch = path.match(/^\/api\/carbitrage\/finds\/([^/]+)$/);
    if (req.method === "GET" && findMatch) return send(res, 200, await services.getFind(user, decodeURIComponent(findMatch[1])));

    const workflowMatch = path.match(/^\/api\/carbitrage\/finds\/([^/]+)\/workflow$/);
    if (req.method === "POST" && workflowMatch) {
      const body = await readJson(req);
      const status = typeof body.status === "string" ? body.status : undefined;
      const watchlisted = typeof body.watchlisted === "boolean" ? body.watchlisted : undefined;
      return send(res, 200, await services.updateWorkflow(user, decodeURIComponent(workflowMatch[1]), { status: status as "new" | undefined, watchlisted }));
    }

    const alertMatch = path.match(/^\/api\/carbitrage\/alerts\/([^/]+)\/read$/);
    if (req.method === "POST" && alertMatch) {
      return send(res, 200, await services.markAlertRead(user, decodeURIComponent(alertMatch[1])));
    }

    if (req.method === "POST" && path === "/api/carbitrage/sales-import") {
      const body = await readJson(req);
      const csv = stringField(body, "csv");
      const yardId = typeof body.yardId === "string" ? body.yardId : undefined;
      return send(res, 200, await services.importSales(user, csv, yardId));
    }

    if (req.method === "POST" && path === "/api/carbitrage/mcp-keys") {
      if (!opts.demoMode) throw new ServiceError(404, "demo_disabled", "Local MCP keys are not issued outside the demo");
      const body = await readJson(req).catch(() => ({}));
      const label = body && typeof body === "object" && typeof (body as { label?: string }).label === "string"
        ? (body as { label: string }).label
        : "portal";
      return send(res, 200, await services.createMcpKey(user, label));
    }

    send(res, 404, { error: "not_found", code: "not_found" });
  } catch (err) {
    if (err instanceof ServiceError) {
      if (err.status === 401 && opts.oauthIssuer && opts.oauthResourceUrl) {
        const metadata = new URL("/.well-known/oauth-protected-resource", opts.oauthResourceUrl);
        res.setHeader("WWW-Authenticate", `Bearer realm="carbitrage", resource_metadata="${metadata.toString()}"`);
      }
      send(res, err.status, { error: err.code, code: err.code, message: err.message });
      return;
    }
    console.error(err instanceof Error ? err.message : "internal");
    send(res, 500, { error: "internal", code: "internal", message: "Internal error" });
  }
}

async function userPrincipal(opts: ServerOptions, req: IncomingMessage): Promise<Principal> {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) {
    return bearerPrincipal(opts, req, "user");
  }
  const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!cookie) throw new ServiceError(401, "unauthenticated", "Sign in required");
  const userId = readSession(cookie, opts.sessionSecret, opts.now());
  if (!userId) throw new ServiceError(401, "unauthenticated", "Sign in required");
  return { kind: "user", userId };
}

async function bearerPrincipal(opts: ServerOptions, req: IncomingMessage, expect: "user" | "ingest"): Promise<Principal> {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new ServiceError(401, "unauthenticated", "Bearer token required");
  }
  const token = header.slice(header.indexOf(" ") + 1).trim();
  if (!token) throw new ServiceError(401, "unauthenticated", "Bearer token required");
  if (expect === "ingest") {
    if (!token.startsWith("cbi_")) throw new ServiceError(401, "unauthenticated", "Ingest token rejected");
    const principalId = await opts.directory.ingestPrincipal(sha256(token));
    if (!principalId) throw new ServiceError(401, "unauthenticated", "Ingest token rejected");
    return { kind: "ingest", principalId };
  }
  if (token.startsWith("cbk_")) {
    if (!opts.demoMode) throw new ServiceError(401, "unauthenticated", "Local demo keys are disabled");
    const userId = await opts.directory.apiKeyUser(sha256(token));
    if (!userId) throw new ServiceError(401, "unauthenticated", "API key rejected");
    return { kind: "user", userId };
  }
  if (!opts.jwtSecret) throw new ServiceError(401, "unauthenticated", "Bearer token was rejected");
  const claims = verifySupabaseJwt(token, opts.jwtSecret, opts.now());
  if (!claims) throw new ServiceError(401, "unauthenticated", "Bearer token was rejected");
  return { kind: "user", userId: claims.sub };
}

function parseFindQuery(url: URL) {
  const under = url.searchParams.get("underFloor");
  return {
    yardId: url.searchParams.get("yardId") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    make: url.searchParams.get("make") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    underFloor: under === "1" || under === "true",
    sort: url.searchParams.get("sort") ?? undefined,
  };
}

function asIngest(raw: unknown): IngestBody {
  if (!raw || typeof raw !== "object") throw new ServiceError(400, "invalid_payload", "JSON object required");
  const body = raw as Record<string, unknown>;
  const floor = body.floorExGov;
  return {
    externalId: typeof body.externalId === "string" ? body.externalId : "",
    sourceSystem: typeof body.sourceSystem === "string" ? body.sourceSystem : "",
    sourceChannel: body.sourceChannel as IngestBody["sourceChannel"],
    sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : "",
    sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : "",
    capturedAt: typeof body.capturedAt === "string" ? body.capturedAt : new Date(0).toISOString(),
    yardId: typeof body.yardId === "string" ? body.yardId : "",
    year: typeof body.year === "number" ? body.year : null,
    make: typeof body.make === "string" ? body.make : "",
    model: typeof body.model === "string" ? body.model : "",
    variant: typeof body.variant === "string" ? body.variant : null,
    variantMatch: body.variantMatch as IngestBody["variantMatch"],
    odometerKm: typeof body.odometerKm === "number" ? body.odometerKm : null,
    askingPrice: typeof body.askingPrice === "number" ? body.askingPrice : null,
    floorExGov: typeof floor === "number" ? floor : null,
    floorSource: typeof body.floorSource === "string" ? body.floorSource : null,
    floorAsOf: typeof body.floorAsOf === "string" ? body.floorAsOf : null,
    photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
    photoCredit: typeof body.photoCredit === "string" ? body.photoCredit : null,
    synthetic: body.synthetic !== false,
    envelope: body.envelope && typeof body.envelope === "object" ? (body.envelope as Record<string, unknown>) : (undefined as unknown as Record<string, unknown>),
  };
}

function stringField(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>)[key] !== "string") {
    throw new ServiceError(400, "invalid_payload", `${key} is required`);
  }
  return (body as Record<string, string>)[key];
}

function personaEmail(persona: Persona): string {
  switch (persona) {
    case "patrick":
      return "patrick@demo.carbitrage.test";
    case "north":
      return "north@demo.carbitrage.test";
    case "group":
      return "group@demo.carbitrage.test";
    case "titled":
      return "titled@demo.carbitrage.test";
    case "outsider":
      return "outsider@demo.carbitrage.test";
    case "addon":
      return "addon@demo.carbitrage.test";
    default: {
      const unhandled: never = persona;
      throw new ServiceError(400, "invalid_payload", `Unknown persona ${String(unhandled)}`);
    }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) throw new ServiceError(413, "invalid_payload", "Body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ServiceError(400, "invalid_payload", "Body is not JSON");
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = await readBody(req);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ServiceError(400, "invalid_payload", "JSON object required");
  }
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}
