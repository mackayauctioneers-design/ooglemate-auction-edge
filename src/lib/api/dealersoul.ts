// DealerSoul client — calls the Lovable edge proxy, which injects the API key
// server-side. Never call the VPS directly from the browser.
import { supabase } from "@/integrations/supabase/client";

async function call<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  // Use functions.invoke so the session JWT is attached automatically.
  const { data, error } = await supabase.functions.invoke(`dealersoul-proxy${path}${qs}`, { method: "GET" });
  if (error) throw error;
  return data as T;
}

export const dealersoul = {
  stats: () => call("/api/v2/stats"),
  deals: (limit = 50) => call("/api/v2/deals", { limit }),
  vehicle: (make: string, model: string, year?: number, km?: number) =>
    call(`/api/v2/vehicle/${encodeURIComponent(make)}/${encodeURIComponent(model)}`, { year, km }),
  marketFloor: (make: string, model: string, year?: number, km?: number) =>
    call("/api/v2/market-floor", { make, model, year, km }),
  fingerprint: (make: string, model: string) => call("/api/v2/fingerprint", { make, model }),
  health: () => call("/health"),
};
