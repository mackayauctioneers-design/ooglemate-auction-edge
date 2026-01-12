import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Fingerprint, Loader2 } from 'lucide-react';

interface FingerprintOutcome {
  id: string;
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
  asof_date: string | null;
}

type ConfidenceLevel = 'high' | 'med' | 'low' | 'unknown';

function getConfidenceLevel(clearedTotal: number | null): ConfidenceLevel {
  if (clearedTotal === null) return 'unknown';
  if (clearedTotal >= 10) return 'high';
  if (clearedTotal >= 3) return 'med';
  if (clearedTotal >= 1) return 'low';
  return 'unknown';
}

function getConfidenceBadgeVariant(level: ConfidenceLevel): 'confidence-high' | 'confidence-mid' | 'confidence-low' | 'outline' {
  switch (level) {
    case 'high': return 'confidence-high';
    case 'med': return 'confidence-mid';
    case 'low': return 'confidence-low';
    default: return 'outline';
  }
}

function formatClearanceRate(cleared: number | null, total: number | null): string {
  if (!cleared || !total || total === 0) return '-';
  return `${Math.round((cleared / total) * 100)}%`;
}

function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString();
}

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '-';
  return `$${Math.round(price).toLocaleString()}`;
}

function formatDays(days: number | null): string {
  if (days === null || days === undefined) return '-';
  return `${Math.round(days)}d`;
}

export default function FingerprintsExplorerPage() {
  const [sortField, setSortField] = useState<keyof FingerprintOutcome>('cleared_total');
  const [sortDesc, setSortDesc] = useState(true);

  const { data: outcomes, isLoading, error } = useQuery({
    queryKey: ['fingerprint-outcomes-latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fingerprint_outcomes_latest')
        .select('*')
        .like('region_id', 'NSW_%')
        .order('cleared_total', { ascending: false, nullsFirst: false })
        .limit(500);

      if (error) throw error;
      return data as FingerprintOutcome[];
    },
  });

  const sortedOutcomes = useMemo(() => {
    if (!outcomes) return [];
    
    return [...outcomes].sort((a, b) => {
      // Primary: confidence (cleared_total desc)
      const confA = getConfidenceLevel(a.cleared_total);
      const confB = getConfidenceLevel(b.cleared_total);
      const confOrder = { high: 3, med: 2, low: 1, unknown: 0 };
      
      if (confOrder[confA] !== confOrder[confB]) {
        return confOrder[confB] - confOrder[confA];
      }
      
      // Secondary: clearance rate desc
      const rateA = a.listing_total ? (a.cleared_total || 0) / a.listing_total : 0;
      const rateB = b.listing_total ? (b.cleared_total || 0) / b.listing_total : 0;
      
      if (rateA !== rateB) {
        return rateB - rateA;
      }
      
      // Tertiary: avg_days_to_clear asc (faster is better)
      const daysA = a.avg_days_to_clear ?? 999;
      const daysB = b.avg_days_to_clear ?? 999;
      
      return daysA - daysB;
    });
  }, [outcomes]);

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

        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center">
            <p className="text-destructive">Failed to load fingerprint outcomes</p>
          </div>
        ) : sortedOutcomes.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Fingerprint className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No fingerprint outcomes found for NSW regions</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <p className="text-sm text-muted-foreground">
                {sortedOutcomes.length} fingerprints • Sorted by confidence → clearance rate → TTD
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
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Clear Rate</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Avg TTD</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-right">Avg Price</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground uppercase text-center">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOutcomes.map((outcome) => {
                    const confidence = getConfidenceLevel(outcome.cleared_total);
                    const badgeVariant = getConfidenceBadgeVariant(confidence);
                    
                    return (
                      <TableRow key={outcome.id} className="border-b border-border">
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
                          {outcome.year_min && outcome.year_max 
                            ? outcome.year_min === outcome.year_max 
                              ? outcome.year_min 
                              : `${outcome.year_min}–${outcome.year_max}`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatNumber(outcome.cleared_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {formatNumber(outcome.listing_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatClearanceRate(outcome.cleared_total, outcome.listing_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatDays(outcome.avg_days_to_clear)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(outcome.avg_price)}
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
