import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, portalApi } from "./api";
import type { ImportResult } from "./types";

export default function ImportPage() {
  const [csv, setCsv] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadSample() {
    setError(null);
    try {
      const sample = await portalApi.sampleCsv();
      setCsv(sample.csv);
      setNote(sample.note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the sample");
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setResult(await portalApi.importCsv(csv));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Sales import</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Adapter <span className="font-medium">pentana_sales_csv_v1</span>. This reads a Pentana-shaped file. It does not connect to Pentana. The yard is your login, even if the file names another dealership.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={loadSample}>Load synthetic sample</Button>
      </div>
      {note ? <p className="mt-3 text-sm text-neutral-600">{note}</p> : null}
      <div className="mt-4 space-y-2">
        <Label htmlFor="sales-csv">CSV</Label>
        <textarea
          id="sales-csv"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          className="min-h-48 w-full border border-neutral-300 p-3 font-mono text-xs"
          placeholder="stock_no,sale_date,make,model,sale_price_inc"
        />
      </div>
      {error ? <p role="alert" className="mt-3 text-sm">{error}</p> : null}
      <Button type="button" className="mt-3" disabled={busy || csv.trim() === ""} onClick={submit}>
        {busy ? "Importing…" : "Import into this yard"}
      </Button>
      {result ? (
        <div className="mt-4 border border-neutral-200 p-3 text-sm" data-testid="import-result">
          <p>Inserted {result.inserted}. Already stored {result.deduped}. Mandates updated {result.mandatesUpserted}.</p>
          {result.warnings.map((warning) => <p key={warning} className="mt-1 text-neutral-600">{warning}</p>)}
          {result.errors.map((row) => <p key={`${row.row}-${row.message}`}>Row {row.row}: {row.message}</p>)}
        </div>
      ) : null}
    </section>
  );
}
