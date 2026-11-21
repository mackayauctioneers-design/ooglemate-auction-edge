import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The dealer site is served from carbitrage.com.au. The API is on another host.
 * Only those two origins may call it from a browser. Cookies are not allowed on
 * that call: the browser sends the Supabase access token instead.
 */
export const ALLOWED_ORIGINS = ["https://carbitrage.com.au", "https://www.carbitrage.com.au"] as const;

export function applyCors(req: IncomingMessage, res: ServerResponse): "continue" | "done" {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!origin) return "continue";
  if (!(ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    if (req.method === "OPTIONS") {
      res.writeHead(403, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify({ error: "cors", code: "cors", message: "This site cannot call the Carbitrage API." }));
      return "done";
    }
    return "continue";
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return "done";
  }
  return "continue";
}
