import { portalApi } from "../api";
import { portalSupabase } from "../runtime";

/** Only ever send someone on to a screen inside the portal. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/portal/") || raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}

/**
 * Signing out clears the Supabase session in this browser (and tells the sign-in server to end it) and clears the Carbitrage
 * session cookie. Either one failing must not leave the other behind.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    const supabase = await portalSupabase();
    // Global sign-out tells the sign-in server to end the session and removes the browser copy. If the server cannot be reached,
    // still remove the browser copy.
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  } catch {
    // no sign-in client in this build
  }
  await portalApi.logout().catch(() => undefined);
}
