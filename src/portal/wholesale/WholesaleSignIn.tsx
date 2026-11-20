import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import carbitrageMarkLight from "@/assets/carbitrage-mark-light.png";
import { ApiError, portalApi } from "../api";
import { wholesaleApi } from "./api";
import { safeNext, signOutEverywhere } from "./auth";

/** The Carbitrage wordmark used on every wholesale screen. */
export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src={carbitrageMarkLight} alt="" className={size === "lg" ? "h-8 w-auto object-contain" : "h-6 w-auto object-contain"} />
      <span className={`${size === "lg" ? "text-xl" : "text-sm"} font-semibold tracking-tight`} data-testid="logo-text">Carbitrage</span>
    </span>
  );
}

const BLACK_BUTTON = "inline-flex min-h-12 w-full items-center justify-center bg-neutral-950 px-6 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300";

/**
 * Sign-in for franchise dealers and approved buyers. The account is the same Ooglecars (Supabase) account they already have.
 * Which side they land on is decided by the server from that account, never by anything chosen here.
 */
export default function WholesaleSignIn({ testEnvironment }: { testEnvironment: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Dealer to the dealer desk, approved buyer to the buyer desk. Anyone else is told plainly and signed out again. */
  async function land(quiet: boolean): Promise<boolean> {
    try {
      const who = await wholesaleApi.me();
      if (who.dealer) { navigate(next && !next.includes("buyer") ? next : "/portal/wholesale/start", { replace: true }); return true; }
      if (who.buyer) { navigate(next && next.includes("buyer") ? next : "/portal/buyer-view", { replace: true }); return true; }
    } catch { /* fall through */ }
    if (!quiet) {
      await signOutEverywhere();
      setError("This account isn't set up for Carbitrage wholesale. Contact Ooglecars to be added.");
    }
    return false;
  }

  useEffect(() => {
    document.title = "Sign in | Carbitrage";
    // Already signed in on this browser: carry on without asking again.
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        await portalApi.exchangeSupabaseToken(data.session.access_token);
        await land(true);
      } catch { /* show the form */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.session) throw new ApiError(401, "unauthenticated", "Email or password is incorrect");
      await portalApi.exchangeSupabaseToken(data.session.access_token);
      await land(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-neutral-950" data-testid="wholesale-sign-in">
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
        <Wordmark size="lg" />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">Use your Ooglecars email and password.</p>
        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <label className="block text-xs text-neutral-500">Email
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="mt-1 block min-h-12 w-full border border-neutral-300 px-3 text-base text-neutral-950" />
          </label>
          <label className="block text-xs text-neutral-500">Password
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="mt-1 block min-h-12 w-full border border-neutral-300 px-3 text-base text-neutral-950" />
          </label>
          {error ? <p role="alert" className="text-sm text-neutral-700" data-testid="sign-in-error">{error}</p> : null}
          <button type="submit" disabled={busy} className={BLACK_BUTTON} data-testid="sign-in-button">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {testEnvironment ? <p className="mt-10 text-[11px] uppercase tracking-wide text-neutral-400" data-testid="test-environment-note">Test environment · test accounts only · nothing is sent</p> : null}
      </main>
    </div>
  );
}

/** Shown instead of a screen when the signed-in account has the other role (or none). */
export function RoleRefusal({ need, who, onSignOut }: { need: "dealer" | "buyer"; who: { dealer: unknown; buyer: unknown } | null; onSignOut: () => void }): ReactNode {
  const navigate = useNavigate();
  const other = need === "dealer" ? who?.buyer : who?.dealer;
  const msg = other
    ? need === "dealer"
      ? "This is a buyer account. The dealer screens are for franchise dealers."
      : "This is a dealer account. The buyer desk is for approved buyers."
    : "This account isn't set up for Carbitrage wholesale.";
  return (
    <div className="mx-auto max-w-md py-24" data-testid="role-refusal">
      <Wordmark />
      <h1 className="mt-10 text-2xl font-semibold tracking-tight">Not available to this account</h1>
      <p className="mt-2 text-sm text-neutral-600" data-testid="role-refusal-text">{msg}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {other ? (
          <button type="button" className={`${BLACK_BUTTON} sm:!w-auto`} data-testid="refusal-go" onClick={() => navigate(need === "dealer" ? "/portal/buyer-view" : "/portal/wholesale/start")}>
            {need === "dealer" ? "Go to the buyer desk" : "Go to the dealer desk"}
          </button>
        ) : null}
        <button type="button" onClick={onSignOut} className="min-h-12 whitespace-nowrap px-4 text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-950" data-testid="refusal-sign-out">Sign out</button>
      </div>
    </div>
  );
}
