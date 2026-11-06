import { useEffect, useState } from "react";
import { ApiError, portalApi } from "./api";
import { aud, when } from "./format";
import { PortalError, PortalLoading, SyntheticMark } from "./states";
import type { Insights } from "./types";

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    portalApi.insights().then(setInsights).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not load insights");
    });
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <PortalError message={error} onRetry={load} />;
  if (!insights) return <PortalLoading label="Loading insights…" />;

  return (
    <section className="space-y-6" data-testid="insights-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-neutral-600">Recent sales show price and date. Sales older than six months are a count and, when there are enough of them, a median.</p>
      </div>
      {insights.publicMarket.map((fact) => (
        <p key={fact.id} className="border border-neutral-200 p-3 text-sm">
          <SyntheticMark show={fact.synthetic} /> <span className="ml-2">{fact.fact}</span>
        </p>
      ))}
      {insights.yards.map((yard) => (
        <article key={yard.yardId} className="border border-neutral-200 p-4">
          <h2 className="text-xl font-semibold">{yard.yardName}</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Open finds</dt><dd className="text-lg font-semibold">{yard.openFinds}</dd></div>
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Under floor</dt><dd className="text-lg font-semibold">{yard.underFloorCount}</dd></div>
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Mandates</dt><dd className="text-lg font-semibold">{yard.mandateCount}</dd></div>
          </dl>
          <h3 className="mt-5 font-semibold">Last 6 months</h3>
          {yard.recentSales.length === 0 ? <p className="mt-2 text-sm">No recent sales on file.</p> : (
            <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200 text-sm">
              {yard.recentSales.map((sale) => (
                <li key={`${sale.soldAt}-${sale.price}`} className="flex justify-between gap-3 px-3 py-2">
                  <span>{when(sale.soldAt)} · {sale.make} {sale.model}{sale.variant ? ` ${sale.variant}` : ""}</span>
                  <span className="font-medium">{aud(sale.price)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-5 font-semibold">Older sales</h3>
          <p className="mt-2 text-sm text-neutral-600">
            {yard.olderSales.count} sale{yard.olderSales.count === 1 ? "" : "s"}.
            {yard.olderSales.medianPrice != null ? ` Median ${aud(yard.olderSales.medianPrice)}.` : ""}
            {yard.olderSales.withheldReason ? ` ${yard.olderSales.withheldReason}` : ""}
          </p>
        </article>
      ))}
    </section>
  );
}
