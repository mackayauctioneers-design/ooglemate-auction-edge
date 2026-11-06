import { useEffect, useState } from "react";
import { ApiError, portalApi } from "./api";
import { km } from "./format";
import { PortalEmpty, PortalError, PortalLoading, SyntheticMark } from "./states";
import type { YardProfile } from "./types";

export default function DnaPage() {
  const [profiles, setProfiles] = useState<YardProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    portalApi.profiles().then((result) => setProfiles(result.profiles)).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not load DNA");
    });
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <PortalError message={error} onRetry={load} />;
  if (!profiles) return <PortalLoading label="Loading yard DNA…" />;
  if (profiles.length === 0) return <PortalEmpty title="No yard on this account" body="Membership is required before DNA is shown." />;

  return (
    <section className="space-y-6" data-testid="dna-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Yard DNA</h1>
        <p className="text-sm text-neutral-600">Mandates and sales counts for yards this login belongs to. A group title without a membership does not add yards.</p>
      </div>
      {profiles.map((profile) => (
        <article key={profile.yard.id} className="border border-neutral-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{profile.yard.name}</h2>
              <p className="text-sm text-neutral-600">
                {profile.yard.franchise ?? "Independent"} · {profile.yard.region} · {profile.role.replace("_", " ")}
              </p>
            </div>
            <SyntheticMark show />
          </div>
          <p className="mt-3 text-sm">
            {profile.yard.ooglecarsYardId
              ? `Optional Ooglecars link on file: ${profile.yard.ooglecarsYardId}.`
              : "Standalone yard. No Ooglecars yard id. An Ooglecars login is not required."}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Sales</dt><dd className="text-lg font-semibold">{profile.salesSummary.total}</dd></div>
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Last 6 months</dt><dd className="text-lg font-semibold">{profile.salesSummary.recentCount}</dd></div>
            <div className="border border-neutral-200 p-3"><dt className="text-neutral-500">Older</dt><dd className="text-lg font-semibold">{profile.salesSummary.olderCount}</dd></div>
          </dl>
          <h3 className="mt-5 font-semibold">Mandates</h3>
          {profile.mandates.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">No mandates yet. Import sales to derive them. No buy price is invented.</p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200">
              {profile.mandates.map((mandate) => (
                <li key={mandate.id} className="px-3 py-3 text-sm">
                  <p className="font-medium">{mandate.make} {mandate.model}</p>
                  <p className="text-neutral-600">
                    Years {mandate.yearMin ?? "—"}–{mandate.yearMax ?? "—"} · up to {km(mandate.kmMax)} · {mandate.derivedFrom.replace("_", " ")}
                  </p>
                  <p className="text-neutral-600">{mandate.notes}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-500">{profile.entitlement.note}</p>
        </article>
      ))}
    </section>
  );
}
