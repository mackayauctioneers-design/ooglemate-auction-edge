import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
  confidence_level: string | null;
  missing_benchmark: boolean | null;
  thin_benchmark: boolean | null;
  stale_benchmark: boolean | null;
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

function getConfidenceBadge(level: string | null) {
  switch (level) {
    case 'high':
      return <Badge variant="default">High</Badge>;
    case 'medium':
      return <Badge variant="secondary">Medium</Badge>;
    case 'low':
      return <Badge variant="outline">Low</Badge>;
    default:
      return <Badge variant="destructive">None</Badge>;
  }
}

function getIssueFlags(r: WatchlistRow) {
  const flags: string[] = [];
  if (r.missing_benchmark) flags.push('Missing');
  if (r.thin_benchmark) flags.push('Thin');
  if (r.stale_benchmark) flags.push('Stale');
  return flags;
}

export default function BenchmarkWatchlistPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('fingerprint_benchmark_watchlist')
      .select('*')
      .limit(100)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRows((data as WatchlistRow[]) || []);
        setLoading(false);
      });
  }, []);

  const handleLogSale = (r: WatchlistRow) => {
    const params = buildLogSaleParams(r);
    navigate(`/log-sale${params ? `?${params}` : ''}`);
  };

  return (
    <OperatorLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Benchmark Watchlist</h1>
          <p className="text-muted-foreground">
            These fingerprints are missing, thin, or stale benchmarks.
            Logging one sale materially improves feed confidence.
          </p>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading benchmark watchlist…</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground">Nothing to improve right now. 👍</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Region</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Years</TableHead>
                  <TableHead className="text-right">Clears</TableHead>
                  <TableHead className="text-right">Avg Days</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead className="text-right">Impact</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const issues = getIssueFlags(r);
                  return (
                    <TableRow key={`${r.region_id}-${r.make}-${r.model}-${r.variant_family}-${r.year_min}-${i}`}>
                      <TableCell>{r.region_id || '—'}</TableCell>
                      <TableCell className="font-medium">
                        {r.make} {r.model} {r.variant_family || ''}
                      </TableCell>
                      <TableCell>
                        {r.year_min && r.year_max
                          ? r.year_min === r.year_max
                            ? r.year_min
                            : `${r.year_min}–${r.year_max}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">{r.cleared_total ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {r.avg_days_to_clear ? `${Math.round(r.avg_days_to_clear)}d` : '—'}
                      </TableCell>
                      <TableCell>{getConfidenceBadge(r.confidence_level)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {issues.map((flag) => (
                            <Badge key={flag} variant="destructive" className="text-xs">
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.impact_score?.toFixed(2) ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => handleLogSale(r)}>
                          Log Sale
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
