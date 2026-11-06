import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import carbitrageLogo from "@/assets/carbitrage-logo.jpg";
import { ApiError, portalApi } from "./api";
import type { Me } from "./types";
import { PortalError, PortalLoading } from "./states";

const LINKS = [
  { to: "/portal/finds", label: "Finds" },
  { to: "/portal/dna", label: "DNA" },
  { to: "/portal/alerts", label: "Alerts" },
  { to: "/portal/insights", label: "Insights" },
  { to: "/portal/import", label: "Sales import" },
  { to: "/portal/connect", label: "Connect" },
];

export default function Shell() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [navigate]);

  async function signOut() {
    await portalApi.logout().catch(() => undefined);
    navigate("/portal/login");
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <PortalError message={error} onRetry={() => window.location.reload()} />
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
