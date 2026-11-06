import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, portalApi } from "./api";
import { aud, channelLabel, km, vehicleTitle } from "./format";
import { PortalEmpty, PortalError, PortalLoading, SyntheticMark, UnderFloor } from "./states";
import type { FindCard, SourceChannel } from "./types";

const SOURCES: Array<{ value: "" | SourceChannel; label: string }> = [
  { value: "", label: "All sources" },
  { value: "auction", label: "Auction" },
  { value: "fleet_lease", label: "Fleet / lease" },
  { value: "government", label: "Government" },
  { value: "dealer_retail", label: "Dealer retail" },
  { value: "aged_stock", label: "Aged stock" },
  { value: "wholesale_trade", label: "Wholesale / trade" },
  { value: "private", label: "Private seller" },
];

export default function FindsPage() {
  const [params, setParams] = useSearchParams();
  const [finds, setFinds] = useState<FindCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    portalApi.finds(params).then((result) => {
      if (active) setFinds(result.finds);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof ApiError ? err.message : "Could not load finds");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [params]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finds</h1>
          <p className="text-sm text-neutral-600">Cars that match this yard. Prices are asking prices, not a promise of margin.</p>
        </div>
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter finds">
        <label className="text-sm">
          <span className="mb-1 block text-neutral-600">Source</span>
          <select className="h-11 w-full border border-neutral-300 bg-white px-2" value={params.get("source") ?? ""} onChange={(event) => setParam("source", event.target.value)}>
            {SOURCES.map((source) => <option key={source.label} value={source.value}>{source.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-600">Make</span>
          <input className="h-11 w-full border border-neutral-300 px-2" value={params.get("make") ?? ""} onChange={(event) => setParam("make", event.target.value)} placeholder="Any make" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-600">Status</span>
          <select className="h-11 w-full border border-neutral-300 bg-white px-2" value={params.get("status") ?? ""} onChange={(event) => setParam("status", event.target.value)}>
            <option value="">Any status</option>
            <option value="new">New</option>
            <option value="watching">Watching</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="passed">Passed</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-600">Sort</span>
          <select className="h-11 w-full border border-neutral-300 bg-white px-2" value={params.get("sort") ?? "under_floor"} onChange={(event) => setParam("sort", event.target.value)}>
            <option value="under_floor">% under floor</option>
            <option value="price_asc">Price, low to high</option>
            <option value="price_desc">Price, high to low</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={params.get("underFloor") === "true"} onChange={(event) => setParam("underFloor", event.target.checked ? "true" : "")} />
          Under floor only
        </label>
      </form>
      <div className="mt-6">
        {loading ? <PortalLoading label="Loading finds…" /> : null}
        {error ? <PortalError message={error} onRetry={() => setParams(new URLSearchParams(params))} /> : null}
        {!loading && !error && finds && finds.length === 0 ? (
          <PortalEmpty title="No finds for this view" body="Nothing in your yards matches these filters. Empty yards stay empty — sample cars are not invented here." />
        ) : null}
        {!loading && !error && finds && finds.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="finds-list">
            {finds.map((find) => (
              <li key={find.id}>
                <Link to={`/portal/finds/${find.id}`} className="block border border-neutral-200 hover:border-neutral-950" data-testid="find-card">
                  {find.photoUrl ? (
                    <img src={find.photoUrl} alt={find.photoCaption ?? vehicleTitle(find)} className="aspect-[16/10] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center bg-neutral-100 text-sm text-neutral-500">No photo on this source</div>
                  )}
                  <div className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SyntheticMark show={find.synthetic} />
                      <span className="text-xs uppercase tracking-wide text-neutral-500">{channelLabel(find.sourceChannel)}</span>
                    </div>
                    {find.photoCaption ? <p className="text-xs text-neutral-500">{find.photoCaption}</p> : null}
                    <h2 className="font-semibold leading-snug">{vehicleTitle(find)}</h2>
                    <p className="text-sm text-neutral-600">{km(find.odometerKm)} · {find.yardName}</p>
                    <p className="text-lg font-semibold">{aud(find.askingPrice)}</p>
                    <p className="text-sm text-neutral-600">
                      {find.floorExGov != null ? `Floor ex-gov ${aud(find.floorExGov)}` : "No floor — evidence missing"}
                    </p>
                    <UnderFloor pct={find.underFloorPct} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
