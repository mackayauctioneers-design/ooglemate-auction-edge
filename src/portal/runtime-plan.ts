/**
 * Pure half of the portal runtime: which host uses the VPS API, and what one call looks like.
 * The live client (src/portal/runtime.ts) uses these. Tests call them with a hostname, so they
 * do not need a browser.
 */

export const VPS_API = "https://srv1422435.hstgr.cloud";
export const OOGLECARS_SUPABASE_URL_DEFAULT = "https://esyinwxhcpexncgqcnwi.supabase.co";
export const OOGLECARS_STORAGE_KEY = "carbitrage-portal-auth";

export function hostUsesVpsApi(hostname: string): boolean {
  return (
    hostname === "carbitrage.com.au" ||
    hostname === "www.carbitrage.com.au" ||
    /(^|--)92b962ba-8cbd-4e77-b734-dd01c5a9be50\.lovable(project)?\.(app|com)$/.test(hostname)
  );
}

/** `forced` is VITE_CARBITRAGE_API_BASE. A string, including "", wins. No host means same-origin. */
export function apiBaseFor(hostname: string | null, forced: string | undefined): string {
  if (typeof forced === "string") return forced.replace(/\/+$/, "");
  if (!hostname) return "";
  return hostUsesVpsApi(hostname) ? VPS_API : "";
}

export interface PortalCall {
  url: string;
  credentials: "omit" | "include";
  headers: { authorization?: string };
}

/** What one API call does from this host. Cross-site: VPS URL, Bearer, no cookies. */
export function portalCall(hostname: string, path: string, accessToken: string | null, forced?: string): PortalCall {
  const base = apiBaseFor(hostname, forced);
  const cross = base !== "";
  return {
    url: `${base}${path}`,
    credentials: cross ? "omit" : "include",
    headers: cross && accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  };
}

export type PortalSignIn =
  | { kind: "shared" }
  | { kind: "ooglecars"; url: string; storageKey: string };

/** Preview and dev keep the shared client. A production build signs in to Ooglecars only. */
export function portalSignIn(mode: string | undefined, dev: boolean, ooglecarsUrl = OOGLECARS_SUPABASE_URL_DEFAULT): PortalSignIn {
  if (mode === "preview" || dev) return { kind: "shared" };
  return { kind: "ooglecars", url: ooglecarsUrl, storageKey: OOGLECARS_STORAGE_KEY };
}
