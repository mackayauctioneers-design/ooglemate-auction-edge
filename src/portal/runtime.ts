/**
 * Where the dealer portal talks to, decided once per page load.
 *
 * - On carbitrage.com.au (served by Lovable) and on this Lovable project's own preview hosts, the API lives on the VPS at
 *   https://srv1422435.hstgr.cloud and is called cross-site: no cookies, the Ooglecars Supabase access token goes in an
 *   Authorization: Bearer header (the server already accepts it on /api/carbitrage/* and /api/wholesale/*).
 * - Anywhere else (the VPS's own Caddy front, local dev, the gated preview) calls stay relative (/api/...) with the session
 *   cookie, exactly as before.
 * VITE_CARBITRAGE_API_BASE overrides the choice at build time ("" forces relative).
 * The session exchange still runs after sign-in, so a login notification is recorded. Cross-site calls do not send that cookie.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase as sharedSupabase } from "@/integrations/supabase/client";
import { apiBaseFor, portalSignIn } from "./runtime-plan";

export { VPS_API, hostUsesVpsApi, apiBaseFor, portalCall, portalSignIn, OOGLECARS_STORAGE_KEY } from "./runtime-plan";

// Ooglecars Supabase (the project the VPS server checks sign-ins against: CARBITRAGE_SUPABASE_ISSUER). Public values only:
// the project URL and its anon/publishable key, which ship in every browser build anyway. NOT the Lovable project's own
// Supabase (VITE_SUPABASE_URL), which the old operator pages keep using.
const OOGLECARS_SUPABASE_URL = import.meta.env.VITE_CARBITRAGE_AUTH_SUPABASE_URL || "https://esyinwxhcpexncgqcnwi.supabase.co";
const OOGLECARS_SUPABASE_KEY = import.meta.env.VITE_CARBITRAGE_AUTH_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeWlud3hoY3BleG5jZ3FjbndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTQ0NTcsImV4cCI6MjA5NTgzMDQ1N30.web-fk71f-hm0fJ-OPY6SB9sNbMaDpIxKTtaxWNp_fg";

function resolveApiBase(): string {
  const forced = import.meta.env.VITE_CARBITRAGE_API_BASE;
  const host = typeof window === "undefined" ? null : window.location.hostname;
  return apiBaseFor(host, typeof forced === "string" ? forced : undefined);
}

export const API_BASE = resolveApiBase();
/** True when the API is on another site: send the Bearer token, never cookies. */
export const CROSS_SITE_API = API_BASE !== "";

let portalClient: Promise<SupabaseClient> | null = null;

/**
 * The sign-in client for the portal. In preview/local builds this is the shared client (test sign-in server or none),
 * so nothing changes there. In production it is a separate client for the Ooglecars Supabase with its own storage key,
 * so it never mixes with the old operator pages' session.
 */
export function portalSupabase(): Promise<SupabaseClient> {
  if (!portalClient) {
    const choice = portalSignIn(import.meta.env.MODE, import.meta.env.DEV, OOGLECARS_SUPABASE_URL);
    portalClient = Promise.resolve(
      choice.kind === "shared"
        ? (sharedSupabase as unknown as SupabaseClient)
        : createClient(choice.url, OOGLECARS_SUPABASE_KEY, {
            auth: { storageKey: choice.storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          }),
    );
  }
  return portalClient;
}

/** Bearer header for cross-site calls (fresh token: supabase-js refreshes it when close to expiry). Empty otherwise. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!CROSS_SITE_API) return {};
  try {
    const client = await portalSupabase();
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export const fetchCredentials: RequestCredentials = CROSS_SITE_API ? "omit" : "include";
