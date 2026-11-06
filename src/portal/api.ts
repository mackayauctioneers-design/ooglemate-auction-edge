import type { AlertView, FindCard, FindDetail, FindStatus, ImportResult, Insights, Me, YardProfile } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network", "The Carbitrage API is not reachable. Start the local portal server.");
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!response.ok) {
    throw new ApiError(response.status, body.code ?? "error", body.message ?? "Request failed");
  }
  return body as T;
}

export const portalApi = {
  health: () => request<{ ok: boolean; demoMode: boolean; billingEnabled: false }>("/api/carbitrage/health"),
  me: () => request<Me>("/api/carbitrage/me"),
  login: (email: string, password: string) =>
    request<{ ok: true; displayName: string }>("/api/carbitrage/session", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  demo: (persona: string) =>
    request<{ ok: true; displayName: string; email: string }>("/api/carbitrage/session/demo", {
      method: "POST",
      body: JSON.stringify({ persona }),
    }),
  logout: () => request<{ ok: true }>("/api/carbitrage/session", { method: "DELETE" }),
  finds: (query: URLSearchParams) => request<{ finds: FindCard[] }>(`/api/carbitrage/finds?${query.toString()}`),
  find: (id: string) => request<FindDetail>(`/api/carbitrage/finds/${encodeURIComponent(id)}`),
  workflow: (id: string, patch: { status?: FindStatus; watchlisted?: boolean }) =>
    request<FindDetail>(`/api/carbitrage/finds/${encodeURIComponent(id)}/workflow`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  profiles: () => request<{ profiles: YardProfile[] }>("/api/carbitrage/profile"),
  insights: () => request<Insights>("/api/carbitrage/insights"),
  alerts: () => request<{ alerts: AlertView[] }>("/api/carbitrage/alerts"),
  markAlert: (id: string) =>
    request<AlertView>(`/api/carbitrage/alerts/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" }),
  sampleCsv: () => request<{ adapter: string; csv: string; synthetic: true; note: string }>("/api/carbitrage/sales-import/sample"),
  importCsv: (csv: string) =>
    request<ImportResult>("/api/carbitrage/sales-import", { method: "POST", body: JSON.stringify({ csv }) }),
  tools: () => request<{ tools: { name: string; description: string }[] }>("/api/carbitrage/mcp/tools"),
  mintKey: () => request<{ token: string; label: string }>("/api/carbitrage/mcp-keys", { method: "POST", body: JSON.stringify({ label: "portal" }) }),
};
