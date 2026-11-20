import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import carbitrageLogo from "@/assets/carbitrage-logo.jpg";
import { ApiError, portalApi } from "./api";
import type { Me } from "./types";
import { PortalError, PortalLoading } from "./states";
import { wholesaleApi, type Me as WholesaleMe } from "./wholesale/api";
import { signOutEverywhere } from "./wholesale/auth";
import { RoleRefusal, Wordmark } from "./wholesale/WholesaleSignIn";

/** The franchise dealer's own screens. A franchise dealer has no Finds, DNA or yard data, so nothing else is offered. */
const WHOLESALE_LINKS = [
  { to: "/portal/wholesale/start", label: "New car" },
  { to: "/portal/wholesale/updates", label: "Updates" },
];

const LINKS = [
  { to: "/portal/finds", label: "Finds" },
  { to: "/portal/wholesale", label: "Wholesale" },
  { to: "/portal/dna", label: "DNA" },
  { to: "/portal/alerts", label: "Alerts" },
  { to: "/portal/insights", label: "Insights" },
  { to: "/portal/import", label: "Sales import" },
  { to: "/portal/connect", label: "Connect" },
];

export default function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const quiet = location.pathname.startsWith("/portal/wholesale");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<WholesaleMe | null>(null);

  // Wholesale screens: who you are comes from the server's own check of your sign-in (dealer feature, or approved buyer link).
  useEffect(() => {
    if (!quiet) return;
    let active = true;
    wholesaleApi.me().then((next) => { if (active) setWho(next); }).catch((err: unknown) => {
      if (!active) return;
      if ((err as { status?: number })?.status === 401) {
        navigate(`/portal/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load the account");
    });
    return () => { active = false; };
  }, [quiet, navigate]);

  useEffect(() => {
    if (quiet) return;
    let active = true;
    portalApi.me().then((next) => {
      if (!active) return;
      setMe(next);
      document.title = `${next.displayName} | Carbitrage`;
    }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) {
        navigate("/portal/login", { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load the account");
    });
    return () => {
      active = false;
    };
  }, [quiet, navigate]);

  async function signOut() {
    await signOutEverywhere();
    navigate("/portal/login");
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <PortalError message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (quiet) {
    if (!who) return <div className="mx-auto max-w-3xl p-6"><PortalLoading label="Checking your account…" /></div>;
    // Only franchise dealers get the dealer screens. A buyer, an ordinary yard's staff, or an account with no role is refused here.
    if (!who.dealer) return <div className="min-h-screen bg-white px-4 text-neutral-950"><RoleRefusal need="dealer" who={who} onSignOut={signOut} /></div>;
    return (
      <div className="min-h-screen bg-white text-neutral-950">
        <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-neutral-200" data-testid="quiet-header">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center"><Wordmark /></div>
            <div className="flex min-w-0 items-center gap-4">
              <span className="truncate text-xs text-neutral-400" data-testid="dealer-name">{who.dealer.name}</span>
              <button type="button" onClick={signOut} className="shrink-0 text-xs text-neutral-400 hover:text-neutral-950" data-testid="sign-out">
                Sign out
              </button>
            </div>
          </div>
          <nav aria-label="Portal" className="mx-auto flex max-w-5xl gap-5 overflow-x-auto whitespace-nowrap px-4 pb-2.5 text-sm [scrollbar-width:none]">
            {WHOLESALE_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `py-1 ${isActive ? "border-b-2 border-neutral-950 text-neutral-950" : "text-neutral-400 hover:text-neutral-950"}`}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main id="portal-main" className="mx-auto max-w-6xl px-4 py-8">
          <Outlet context={null} />
        </main>
      </div>
    );
  }
  if (!me) return <div className="mx-auto max-w-3xl p-6"><PortalLoading label="Checking your account…" /></div>;

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={carbitrageLogo} alt="Carbitrage" className="h-8 w-auto bg-white object-contain" />
            <div>
              <p className="text-sm font-semibold">Carbitrage</p>
              <p className="text-xs text-neutral-300">{me.yards.map((yard) => yard.name).join(" · ")}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm">{me.displayName}</p>
            <button type="button" onClick={signOut} className="text-xs text-neutral-300 underline-offset-2 hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="border-b border-neutral-200 bg-neutral-50">
        <p className="mx-auto max-w-6xl px-4 py-2 text-xs text-neutral-600" data-testid="synthetic-banner">
          Synthetic demo records. Not live stock. Billing is off. Ooglecars login is not required.
        </p>
        <nav aria-label="Portal" className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 pb-2">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `min-h-11 px-3 py-2 text-sm ${isActive ? "bg-neutral-950 text-white" : "text-neutral-700 hover:bg-neutral-200"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <main id="portal-main" className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={me} />
      </main>
    </div>
  );
}
