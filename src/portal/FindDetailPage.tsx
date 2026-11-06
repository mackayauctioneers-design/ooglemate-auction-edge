import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ApiError, portalApi } from "./api";
import { aud, channelLabel, km, vehicleTitle, when } from "./format";
import { PortalError, PortalLoading, SyntheticMark, UnderFloor } from "./states";
import type { FindDetail, FindStatus } from "./types";

export default function FindDetailPage() {
  const { id = "" } = useParams();
  const [find, setFind] = useState<FindDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    portalApi.find(id).then(setFind).catch((err: unknown) => {
      setFind(null);
      setError(err instanceof ApiError ? err.message : "Could not load this find");
    }).finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    portalApi.find(id).then((next) => {
      if (active) setFind(next);
    }).catch((err: unknown) => {
      if (!active) return;
      setFind(null);
      setError(err instanceof ApiError ? err.message : "Could not load this find");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  async function update(patch: { status?: FindStatus; watchlisted?: boolean }) {
    setSaving(true);
    try {
      setFind(await portalApi.workflow(id, patch));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this find");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PortalLoading label="Loading find…" />;
  if (error) return <PortalError message={error} onRetry={load} />;
  if (!find) return <PortalError message="Find not available" onRetry={load} />;

  return (
    <article data-testid="find-detail">
      <Link to="/portal/finds" className="text-sm underline-offset-2 hover:underline">Back to finds</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          {find.photoUrl ? (
            <img src={find.photoUrl} alt={vehicleTitle(find)} className="aspect-[16/10] w-full border border-neutral-200 object-cover" />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center border border-neutral-200 bg-neutral-100 text-sm">No photo on this source</div>
          )}
          {find.photoCredit ? <p className="mt-2 text-xs text-neutral-500">{find.photoCredit}</p> : null}
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <SyntheticMark show={find.synthetic} />
            <span className="text-xs uppercase tracking-wide text-neutral-500">{find.status}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{vehicleTitle(find)}</h1>
          <p className="text-neutral-600">{km(find.odometerKm)} · {find.yardName}</p>
          <p className="text-3xl font-semibold">{aud(find.askingPrice)}</p>
          <div className="border border-neutral-200 p-3 text-sm">
            <p className="font-medium">Floor, excluding government charges</p>
            {find.floorExGov != null ? (
              <>
                <p className="mt-1 text-lg">{aud(find.floorExGov)}</p>
                <p className="text-neutral-600">Source: {find.floorSource ?? "Not recorded"}</p>
                <p className="text-neutral-600">As of {find.floorAsOf ?? "unknown"} · {find.freshness}</p>
              </>
            ) : (
              <p className="mt-1 text-neutral-600">No floor is shown. Variant evidence is {find.variantMatch.replace(/_/g, " ")}. A price was not estimated.</p>
            )}
            <UnderFloor pct={find.underFloorPct} />
            {find.underFloorPct == null && find.floorExGov != null ? <p className="text-neutral-500">Not under the floor.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={find.watchlisted ? "default" : "outline"} disabled={saving} onClick={() => update({ watchlisted: !find.watchlisted, status: find.watchlisted ? find.status : "watching" })}>
              {find.watchlisted ? "On watchlist" : "Add to watchlist"}
            </Button>
            <Button type="button" variant={find.status === "shortlisted" ? "default" : "outline"} disabled={saving} onClick={() => update({ status: "shortlisted" })}>
              Shortlist
            </Button>
            <Button type="button" variant={find.status === "passed" ? "default" : "outline"} disabled={saving} onClick={() => update({ status: "passed" })}>
              Pass
            </Button>
          </div>
        </div>
      </div>
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Source</h2>
          <p className="mt-2 text-sm">{channelLabel(find.sourceChannel)} · {find.sourceLabel}</p>
          <p className="text-sm text-neutral-600">Captured {when(find.capturedAt)}. {find.freshness}</p>
          <a className="mt-2 inline-block text-sm underline" href={find.sourceUrl} target="_blank" rel="noreferrer" data-testid="source-link">
            Open original source
          </a>
          <p className="mt-1 break-all text-xs text-neutral-500">{find.sourceUrl}</p>
        </div>
        <div>
          <h2 className="font-semibold">Evidence</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {find.evidence.map((item) => (
              <li key={item.label}>
                <span className="font-medium">{item.label}. </span>
                {item.detail}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">Original source payload retained for this yard: {find.sourceRetained ? "yes" : "no"}.</p>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="font-semibold">Own sales comparison</h2>
        <p className="mt-1 text-sm text-neutral-600">{find.comparables.variantNote}</p>
        {find.comparables.recent.length === 0 ? (
          <p className="mt-3 text-sm">No sales of this make and model in the last 6 months.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200 text-sm">
            {find.comparables.recent.map((sale) => (
              <li key={`${sale.soldAt}-${sale.price}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>{when(sale.soldAt)} · {sale.make} {sale.model}</span>
                <span className="font-medium">{aud(sale.price)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-neutral-600">
          Older sales: {find.comparables.older.count}.
          {find.comparables.older.medianPrice != null ? ` Median ${aud(find.comparables.older.medianPrice)}.` : ""}
          {find.comparables.older.withheldReason ? ` ${find.comparables.older.withheldReason}` : ""}
        </p>
      </section>
    </article>
  );
}
