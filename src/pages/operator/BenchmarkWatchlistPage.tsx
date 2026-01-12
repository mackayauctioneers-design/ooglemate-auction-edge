import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type WatchlistRow = {
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
  confidence_level: 'high' | 'medium' | 'low' | 'none';
  missing_benchmark: boolean;
  thin_benchmark: boolean;
  stale_benchmark: boolean;
  impact_score: number | null;
};

function buildLogSaleParams(r: WatchlistRow) {
  const p = new URLSearchParams();
  if (r.region_id) p.set('region_id', r.region_id);
  if (r.make) p.set('make', r.make);
  if (r.model) p.set('model', r.model);
  if (r.variant_family) p.set('variant', r.variant_family);
  const year = r.year_max ?? r.year_min ?? null;
  if (year !== null) p.set('year', String(year));
  if (r.year_min !== null) p.set('year_min', String(r.year_min));
  if (r.year_max !== null) p.set('year_max', String(r.year_max));
  return p.toString();
}

function confidenceBadge(level: WatchlistRow['confidence_level']) {
  switch (level) {
    case 'high':
      return <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">High</Badge>;
    case 'medium':
      return <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30">Medium</Badge>;
    case 'low':
      return <Badge className="bg-blue-500/15 text-blue-300 border border-blue-500/30">Low</Badge>;
    default:
      return <Badge variant="outline">None</Badge>;
  }
}

function issueBadges(r: WatchlistRow) {
  const flags: string[] = [];
  if (r.missing_benchmark) flags.push('Missing');
  if (r.thin_benchmark) flags.push('Thin');
  if (r.stale_benchmark) flags.push('Stale');

  if (!flags.length) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex gap-2 flex-wrap">
      {flags.map((f) => (
        <Badge key={f} variant="secondary">{f}</Badge>
      ))}
    </div>
  );
}

export default function BenchmarkWatchlistPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('fingerprint_benchmark_watchlist')
      .select('*')
      .limit(200)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRows((data as WatchlistRow[]) || []);
        setLoading(false);
      });
  }, []);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0));
  }, [rows]);

  const handleLogSale = (r: WatchlistRow) => {
    const params = buildLogSaleParams(r);
    navigate(`/log-sale${params ? `?${params}` : ''}`);
  };

  return (
    <OperatorLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Benchmark Watchlist</CardTitle>
            <p className="text-muted-foreground">
              Missing / thin / stale benchmarks (ranked by impact). Log one sale to improve feed confidence.
            </p>
          </CardHeader>
        </Card>

        {loading ? (
          <div className="text-muted-foreground">Loading benchmark watchlist…</div>
        ) : sorted.length === 0 ? (
          <div className="text-muted-foreground">Nothing to improve right now. 👍</div>
        ) : (
          <Card>
            <CardContent className="pt-6 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2">Region</th>
                    <th className="text-left py-2">Vehicle</th>
                    <th className="text-left py-2">Years</th>
                    <th className="text-left py-2">Clears</th>
                    <th className="text-left py-2">Avg Days</th>
                    <th className="text-left py-2">Confidence</th>
                    <th className="text-left py-2">Issues</th>
                    <th className="text-left py-2">Impact</th>
                    <th className="text-left py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={`${r.region_id}-${r.make}-${r.model}-${r.variant_family}-${r.year_min}-${i}`} className="border-b last:border-b-0">
                      <td className="py-3">{r.region_id || '—'}</td>
                      <td className="py-3">
                        {r.make || '—'} {r.model || '—'} {r.variant_family || ''}
                      </td>
                      <td className="py-3">
                        {r.year_min && r.year_max
                          ? r.year_min === r.year_max
                            ? r.year_min
                            : `${r.year_min}–${r.year_max}`
                          : '—'}
                      </td>
                      <td className="py-3">{r.cleared_total ?? '—'}</td>
                      <td className="py-3">{r.avg_days_to_clear ? `${Math.round(r.avg_days_to_clear)}d` : '—'}</td>
                      <td className="py-3">{confidenceBadge(r.confidence_level)}</td>
                      <td className="py-3">{issueBadges(r)}</td>
                      <td className="py-3 font-mono">{r.impact_score ? r.impact_score.toFixed(2) : '—'}</td>
                      <td className="py-3">
                        <Button size="sm" onClick={() => handleLogSale(r)}>
                          Log Sale
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </OperatorLayout>
  );
}
