import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';

type GapRow = {
  region_id: string | null;
  make: string | null;
  model: string | null;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  cleared_total: number | null;
  listing_total: number | null;
  avg_days_to_clear: number | null;
  avg_price: number | null;
};

export default function BenchmarkGapPanel() {
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('fingerprint_benchmark_gaps')
      .select('*')
      .limit(100)
      .then(({ data }) => {
        setRows((data as GapRow[]) || []);
        setLoading(false);
      });
  }, []);

  return (
    <OperatorLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Benchmark Gaps</h1>

        <p className="text-muted-foreground">
          These fingerprints have cleared sales but no benchmark price yet.
          Log a sale for any of these to immediately improve feed confidence.
        </p>

        {loading ? (
          <div className="text-muted-foreground">Loading benchmark gaps…</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground">No benchmark gaps found. Great job! 🎉</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Region</th>
                  <th className="p-2 text-left">Make</th>
                  <th className="p-2 text-left">Model</th>
                  <th className="p-2 text-left">Variant</th>
                  <th className="p-2 text-left">Years</th>
                  <th className="p-2 text-right">Cleared</th>
                  <th className="p-2 text-right">Avg Days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-muted/50">
                    <td className="p-2">{r.region_id || '—'}</td>
                    <td className="p-2">{r.make || '—'}</td>
                    <td className="p-2">{r.model || '—'}</td>
                    <td className="p-2">{r.variant_family || '—'}</td>
                    <td className="p-2">
                      {r.year_min === r.year_max
                        ? r.year_min
                        : `${r.year_min}–${r.year_max}`}
                    </td>
                    <td className="p-2 text-right font-semibold">{r.cleared_total ?? '—'}</td>
                    <td className="p-2 text-right">
                      {r.avg_days_to_clear
                        ? `${Math.round(r.avg_days_to_clear)}d`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
