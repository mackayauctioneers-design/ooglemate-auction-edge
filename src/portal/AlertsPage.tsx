import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ApiError, portalApi } from "./api";
import { when } from "./format";
import { PortalEmpty, PortalError, PortalLoading } from "./states";
import type { AlertView } from "./types";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    portalApi.alerts().then((result) => setAlerts(result.alerts)).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not load alerts");
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function mark(id: string) {
    const next = await portalApi.markAlert(id);
    setAlerts((current) => current?.map((alert) => (alert.id === id ? next : alert)) ?? null);
  }

  if (error) return <PortalError message={error} onRetry={load} />;
  if (!alerts) return <PortalLoading label="Loading alerts…" />;

  return (
    <section data-testid="alerts-page">
      <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
      <p className="mt-1 text-sm text-neutral-600">Under-floor and DNA matches for your yards. Nothing here sends a message or places a bid.</p>
      {alerts.length === 0 ? (
        <div className="mt-6">
          <PortalEmpty title="No alerts" body="When a find lands under your floor or on a mandate, it shows up here." />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200 border border-neutral-200">
          {alerts.map((alert) => (
            <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
              <div>
                <p className={`text-sm ${alert.read ? "text-neutral-500" : "font-medium"}`}>{alert.message}</p>
                <p className="text-xs text-neutral-500">{when(alert.createdAt)} · {alert.kind.replace("_", " ")}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link to={`/portal/finds/${alert.opportunityId}`}>Open</Link>
                </Button>
                {alert.read ? null : (
                  <Button type="button" variant="outline" onClick={() => mark(alert.id)}>Mark read</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
