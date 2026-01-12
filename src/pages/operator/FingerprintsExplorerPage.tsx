import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Fingerprint, Loader2 } from 'lucide-react';

type Confidence = 'high' | 'med' | 'low' | 'unknown';

interface FingerprintOutcome {
  region_id: string | null;
  make: string | null;
  model: string | null;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  km_band_min: number | null;
  km_band_max: number | null;
  listing_total: number | null;
  cleared_total: number | null;
  passed_in_total: number | null;
  relisted_total: number | null;
  avg_days_to_clear: number | null;
  avg_price: number | null;
  asof_date?: string | null;
}

const NSW_REGION_OPTIONS = [
  { value: 'NSW_%', label: 'All NSW' },
  { value: 'NSW_SYDNEY_METRO', label: 'NSW Sydney Metro' },
  { value: 'NSW_CENTRAL_COAST', label: 'NSW Central Coast' },
  { value: 'NSW_HUNTER_NEWCASTLE', label: 'NSW Hunter / Newcastle' },
  { value: 'NSW_REGIONAL', label: 'NSW Regional' },
];

function confidenceLevel(cleared: number | null): Confidence {
  const c = cleared ?? 0;
  if (c >= 10) return 'high';
  if (c >= 3) return 'med';
  if (c >= 1) return 'low';
  return 'unknown';
}

function confRank(c: Confidence): number {
  return c === 'high' ? 3 : c === 'med' ? 2 : c === 'low' ? 1 : 0;
}

function getConfidenceBadgeVariant(level: Confidence): 'confidence-high' | 'confidence-mid' | 'confidence-low' | 'outline' {
  switch (level) {
    case 'high': return 'confidence-high';
    case 'med': return 'confidence-mid';
    case 'low': return 'confidence-low';
    default: return 'outline';
  }
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString();
}

function fmtPct(cleared: number | null, total: number | null): string {
  const t = total ?? 0;
  const cl = cleared ?? 0;
  if (t <= 0) return '-';
  return `${Math.round((cl / t) * 100)}%`;
}

function fmtPrice(p: number | null): string {
  if (p === null || p === undefined) return '-';
  return new Intl.NumberFormat('en-AU', { 
    style: 'currency', 
    currency: 'AUD', 
    maximumFractionDigits: 0 
  }).format(p);
}

function fmtDays(days: number | null): string {
  if (days === null || days === undefined) return '-';
  return `${Math.round(days)}d`;
}

export default function FingerprintsExplorerPage() {
  const [regionFilter, setRegionFilter] = useState('NSW_%');
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence | 'all'>('all');
  const [makeFilter, setMakeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['fingerprints-explorer', regionFilter],
    queryFn: async () => {
      let q = supabase.from('fingerprint_outcomes_latest').select('*');

      if (regionFilter === 'NSW_%') {
        q = q.like('region_id', 'NSW_%');
      } else {
        q = q.eq('region_id', regionFilter);
      }

      const { data, error } = await q.limit(2000);
      if (error) throw error;
      return (data || []) as FingerprintOutcome[];
    },
  });

  const makes = useMemo(() => {
    const set = new Set<string>();
    (data || []).forEach((r) => {
      if (r.make) set.add(r.make);
    });
    return ['all', ...Array.from(set).sort()];
  }, [data]);

  const rows = useMemo(() => {
    let r = [...(data || [])];

    // Filter by confidence
    if (confidenceFilter !== 'all') {
      r = r.filter((x) => confidenceLevel(x.cleared_total) === confidenceFilter);
    }

    // Filter by make
    if (makeFilter !== 'all') {
      r = r.filter((x) => (x.make || '').toUpperCase() === makeFilter.toUpperCase());
    }

    // Filter by search
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((x) => {
        const hay = `${x.make || ''} ${x.model || ''} ${x.variant_family || ''}`.toLowerCase();
        return hay.includes(s);
      });
    }

    // Sort: confidence desc → clearance rate desc → avg_days_to_clear asc → listing_total desc
    r.sort((a, b) => {
      const ca = confidenceLevel(a.cleared_total);
      const cb = confidenceLevel(b.cleared_total);
      if (confRank(ca) !== confRank(cb)) return confRank(cb) - confRank(ca);

      const ra = (a.listing_total ?? 0) > 0 ? (a.cleared_total ?? 0) / (a.listing_total ?? 1) : 0;
      const rb = (b.listing_total ?? 0) > 0 ? (b.cleared_total ?? 0) / (b.listing_total ?? 1) : 0;
      if (ra !== rb) return rb - ra;

      const da = a.avg_days_to_clear ?? 9999;
      const db = b.avg_days_to_clear ?? 9999;
      if (da !== db) return da - db;

      return (b.listing_total ?? 0) - (a.listing_total ?? 0);
    });

    return r;
  }, [data, confidenceFilter, makeFilter, search]);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Fingerprint className="h-6 w-6 text-primary" />
            Fingerprints Explorer
          </h1>
          <p className="text-muted-foreground mt-1">
            Browse fingerprint outcomes for NSW regions
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Region</label>
                <Select value={regionFilter} onValueChange={setRegionFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NSW_REGION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Confidence</label>
                <Select value={confidenceFilter} onValueChange={(v) => setConfidenceFilter(v as Confidence | 'all')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="high">High (≥10 cleared)</SelectItem>
                    <SelectItem value="med">Med (≥3 cleared)</SelectItem>
                    <SelectItem value="low">Low (≥1 cleared)</SelectItem>
                    <SelectItem value="unknown">Unknown (0)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Make</label>
                <Select value={makeFilter} onValueChange={setMakeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {makes.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m === 'all' ? 'All' : m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Search</label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g., Corolla Hybrid"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center">
            <p className="text-destructive">Failed to load fingerprint outcomes</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Fingerprint className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No fingerprint outcomes found</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <p className="text-sm text-muted-foreground">
                {rows.length} fingerprints • Sorted by confidence → clearance rate → TTD
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Region</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Make</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Model</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Variant</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Years</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Cleared</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Listed</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Clear %</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Avg TTD</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Avg Price</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-center">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((outcome, idx) => {
                    const confidence = confidenceLevel(outcome.cleared_total);
                    const badgeVariant = getConfidenceBadgeVariant(confidence);
                    const years =
                      outcome.year_min && outcome.year_max
                        ? outcome.year_min === outcome.year_max
                          ? `${outcome.year_min}`
                          : `${outcome.year_min}–${outcome.year_max}`
                        : '-';

                    return (
                      <TableRow 
                        key={`${outcome.region_id}-${outcome.make}-${outcome.model}-${outcome.variant_family}-${idx}`} 
                        className="border-b border-border"
                      >
                        <TableCell className="font-mono text-xs">
                          {outcome.region_id || '-'}
                        </TableCell>
                        <TableCell className="font-medium">
                          {outcome.make || '-'}
                        </TableCell>
                        <TableCell>
                          {outcome.model || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {outcome.variant_family || 'ALL'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {years}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {fmtNum(outcome.cleared_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {fmtNum(outcome.listing_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {fmtPct(outcome.cleared_total, outcome.listing_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtDays(outcome.avg_days_to_clear)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtPrice(outcome.avg_price)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={badgeVariant} className="uppercase text-xs">
                            {confidence}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
