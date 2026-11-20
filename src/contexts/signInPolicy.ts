/**
 * What the shared sign-in does after a session appears, depending on where the person signed in.
 *
 * Ooglecars screens: load the Ooglecars role and dealer profile, record a login row, and send the login notification.
 * Carbitrage portal (/portal/*, franchise dealers and wholesale buyers): record the login row and send the login notification
 * (Macka wants to see franchise sign-ins), but do NOT look up an Ooglecars role or dealer profile. Franchise people have none.
 * (Macka OK'd the notifications on 20 Nov 2026, 2:16pm Sydney. The 12-hour session is unchanged.)
 */
export type SignInActions = { loadOoglecarsProfile: boolean; recordLogin: boolean; notifyLogin: boolean };

export const isCarbitragePortalPath = (pathname: string | undefined): boolean =>
  typeof pathname === "string" && (pathname === "/portal" || pathname.startsWith("/portal/"));

/** `event` is the Supabase auth event; only a fresh SIGNED_IN is a login. */
export function signInActions(pathname: string | undefined, event: string): SignInActions {
  const login = event === "SIGNED_IN";
  return { loadOoglecarsProfile: !isCarbitragePortalPath(pathname), recordLogin: login, notifyLogin: login };
}
