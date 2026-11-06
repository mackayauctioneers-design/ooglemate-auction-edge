import { ServiceError, type Principal } from "./domain.ts";
import type { CarbitrageServices, FindQuery } from "./services.ts";

export const MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const YARD_PROP = {
  yardId: {
    type: "string",
    description: "Optional. Must be one of the yards bound to this key. Ignored as an authority if it is not.",
  },
};

export function toolCatalog(): ToolDef[] {
  return [
    {
      name: "list_finds",
      description: "List this account's own finds. Scope comes from the API key membership, not from a caller-supplied tenant.",
      inputSchema: {
        type: "object",
        properties: {
          ...YARD_PROP,
          source: { type: "string" },
          make: { type: "string" },
          status: { type: "string" },
          underFloor: { type: "boolean" },
          sort: { type: "string", enum: ["under_floor", "price_asc", "price_desc", "newest"] },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_find",
      description: "Detail for one of this account's finds, including retained source payload and own-yard comparisons.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_yard_profile",
      description: "Own yard or explicitly authorised group yards: profile, DNA mandates, and sales counts. No other dealership's figures.",
      inputSchema: { type: "object", properties: { ...YARD_PROP }, additionalProperties: false },
    },
    {
      name: "get_insights",
      description: "Own insights. Recent sales include price and date for 6 months. Older sales are aggregates only. Includes own alerts.",
      inputSchema: { type: "object", properties: { ...YARD_PROP }, additionalProperties: false },
    },
    {
      name: "update_find_workflow",
      description: "Update watchlist or status on this account's own find. Cannot message sellers, bid, book, or spend.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          watchlisted: { type: "boolean" },
          status: { type: "string", enum: ["new", "watching", "shortlisted", "passed"] },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  ];
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export async function handleMcp(
  services: CarbitrageServices,
  principal: Principal,
  raw: unknown,
): Promise<{ status: number; body: unknown | null }> {
  if (Array.isArray(raw)) {
    const responses = [];
    for (const item of raw) {
      const one = await handleSingle(services, principal, item);
      if (one.body != null) responses.push(one.body);
    }
    if (responses.length === 0) return { status: 202, body: null };
    return { status: 200, body: responses };
  }
  return handleSingle(services, principal, raw);
}

async function handleSingle(
  services: CarbitrageServices,
  principal: Principal,
  raw: unknown,
): Promise<{ status: number; body: unknown | null }> {
  if (!raw || typeof raw !== "object") {
    return { status: 400, body: rpcError(null, -32600, "Invalid request") };
  }
  const msg = raw as JsonRpcRequest;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { status: 400, body: rpcError(msg.id ?? null, -32600, "Invalid request") };
  }
  const isNotification = msg.id === undefined || msg.id === null;
  try {
    const result = await dispatch(services, principal, msg.method, msg.params ?? {});
    if (isNotification) return { status: 202, body: null };
    return { status: 200, body: { jsonrpc: "2.0", id: msg.id, result } };
  } catch (err) {
    const mapped = mapErr(err);
    if (isNotification) return { status: mapped.http, body: null };
    return { status: mapped.http, body: rpcError(msg.id ?? null, mapped.code, mapped.message) };
  }
}

async function dispatch(services: CarbitrageServices, principal: Principal, method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "initialize":
      return initialize(params);
    case "notifications/initialized":
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolCatalog() };
    case "tools/call":
      return await callTool(services, principal, params);
    default:
      throw new ServiceError(400, "method_not_found", "Method not found");
  }
}

function initialize(params: unknown): unknown {
  const version = typeof params === "object" && params && "protocolVersion" in params
    ? String((params as { protocolVersion?: string }).protocolVersion ?? "")
    : "";
  const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)
    ? version
    : "2025-03-26";
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "carbitrage", version: "0.1.0" },
    instructions:
      "Carbitrage dealer tools. Identity comes from a verified Supabase JWT, or from a local demo key only when demo mode is enabled. A yard id argument is not a membership. No bids, seller messages, bookings or payments. This is not a hosted ChatGPT, Claude or Grok OAuth connection unless CARBITRAGE_OAUTH_ISSUER is configured.",
  };
}

async function callTool(services: CarbitrageServices, principal: Principal, params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object" || typeof (params as { name?: string }).name !== "string") {
    throw new ServiceError(400, "invalid_payload", "tools/call needs a name");
  }
  const name = (params as { name: string }).name;
  const args = ((params as { arguments?: unknown }).arguments ?? {}) as Record<string, unknown>;
  try {
    const data = await runTool(services, principal, name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      isError: false,
    };
  } catch (err) {
    if (err instanceof ServiceError && (err.status === 401 || err.status === 403 || err.status === 404)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "denied", code: err.code }) }],
        isError: true,
      };
    }
    throw err;
  }
}

async function runTool(services: CarbitrageServices, principal: Principal, name: string, args: Record<string, unknown>): Promise<unknown> {
  const yardId = typeof args.yardId === "string" ? args.yardId : undefined;
  switch (name) {
    case "list_finds":
      return await services.listFinds(principal, {
        yardId,
        source: typeof args.source === "string" ? args.source : undefined,
        make: typeof args.make === "string" ? args.make : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        underFloor: args.underFloor === true,
        sort: typeof args.sort === "string" ? args.sort : undefined,
      } satisfies FindQuery);
    case "get_find":
      if (typeof args.id !== "string") throw new ServiceError(400, "invalid_payload", "id is required");
      return await services.getFind(principal, args.id);
    case "get_yard_profile":
      return await services.profiles(principal, yardId);
    case "get_insights":
      return await services.insights(principal, yardId);
    case "update_find_workflow": {
      if (typeof args.id !== "string") throw new ServiceError(400, "invalid_payload", "id is required");
      const status = args.status;
      const watchlisted = args.watchlisted;
      return await services.updateWorkflow(principal, args.id, {
        ...(typeof status === "string" ? { status: status as "new" } : {}),
        ...(typeof watchlisted === "boolean" ? { watchlisted } : {}),
      });
    }
    default:
      throw new ServiceError(400, "method_not_found", `Unknown tool ${name}`);
  }
}

function mapErr(err: unknown): { http: number; code: number; message: string } {
  if (err instanceof ServiceError) {
    if (err.code === "method_not_found") return { http: 200, code: -32601, message: err.message };
    if (err.status === 401) return { http: 401, code: -32001, message: err.message };
    if (err.status === 400) return { http: 400, code: -32602, message: err.message };
    return { http: err.status, code: -32000, message: err.message };
  }
  return { http: 500, code: -32603, message: "Internal error" };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
