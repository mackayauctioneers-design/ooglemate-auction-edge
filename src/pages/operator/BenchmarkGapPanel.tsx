import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

function buildLogSaleParams(r: GapRow) {
  const p = new URLSearchParams();
  if (r.region_id) p.set('region_id', r.region_id);
  if (r.make) p.set('make', r.make);
  if (r.model) p.set('model', r.model);
  // LogSalePage uses variant_normalised, so pass as 'variant'
  if (r.variant_family && r.variant_family !== 'ALL') p.set('variant', r.variant_family);
  // Pick a default year (use year_max if available)
  const year = r.year_max ?? r.year_min ?? null;
  if (year !== null) p.set('year', String(year));
  // Keep the range too (useful later)
  if (r.year_min !== null) p.set('year_min', String(r.year_min));
  if (r.year_max !== null) p.set('year_max', String(r.year_max));
  return p.toString();
}

export default function BenchmarkGapPanel() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('fingerprint_benchmark_gaps')
      .select('*')
      .limit(200)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRows((data as GapRow[]) || []);
        setLoading(false);
      });
  }, []);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ca = a.cleared_total ?? 0;
      const cb = b.cleared_total ?? 0;
      if (cb !== ca) return cb - ca;
      const da = a.avg_days_to_clear ?? 9999;
      const db = b.avg_days_to_clear ?? 9999;
      return da - db;
    });
  }, [rows]);

  const handleLogSale = (r: GapRow) => {
    const params = buildLogSaleParams(r);
    navigate(`/log-sale${params ? `?${params}` : ''}`);
  };

  return (
    <OperatorLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Benchmark Gaps</h1>
          <p className="text-muted-foreground">
            These fingerprints have cleared sales but no benchmark price yet.
            Log a sale for any of these to immediately improve feed confidence.
          </p>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading benchmark gaps…</div>
        ) : sorted.length === 0 ? (
          <div className="text-muted-foreground">No benchmark gaps found. Great job! 🎉</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Region</TableHead>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Years</TableHead>
                  <TableHead className="text-right">Cleared</TableHead>
                  <TableHead className="text-right">Avg Days</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={`${r.region_id}-${r.make}-${r.model}-${r.variant_family}-${r.year_min}-${i}`}>
                    <TableCell>{r.region_id || '—'}</TableCell>
                    <TableCell>{r.make || '—'}</TableCell>
                    <TableCell>{r.model || '—'}</TableCell>
                    <TableCell>{r.variant_family || 'ALL'}</TableCell>
                    <TableCell>
                      {r.year_min && r.year_max
                        ? r.year_min === r.year_max
                          ? r.year_min
                          : `${r.year_min}–${r.year_max}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{r.cleared_total ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.avg_days_to_clear
                        ? `${Math.round(r.avg_days_to_clear)}d`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => handleLogSale(r)}
                      >
                        Log Sale
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
