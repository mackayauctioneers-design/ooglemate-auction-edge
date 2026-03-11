import { useEffect, useState } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface RetailListing {
  id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  year: number | null;
  asking_price: number;
  market_price: number | null;
  km: number | null;
  price_badge: string | null;
  price_difference: number | null;
  price_difference_percent: number | null;
  listing_url: string | null;
  source: string;
  seller_type: string | null;
  region_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  lifecycle_status: string | null;
  comp_count: number | null;
  market_confidence: string | null;
  market_price_source: string | null;
}

function ConfidenceBadge({ confidence, compCount }: { confidence: string | null; compCount: number | null }) {
  if (!confidence || confidence === 'INSUFFICIENT') return <span className="text-xs text-muted-foreground">—</span>;
  const color = confidence === 'HIGH' ? 'text-green-600 dark:text-green-400' 
    : confidence === 'MEDIUM' ? 'text-amber-600 dark:text-amber-400' 
    : 'text-red-500';
  return (
    <span className={`text-xs font-medium ${color}`}>
      {confidence} ({compCount})
    </span>
  );
}

function ListingsTable({ listings }: { listings: RetailListing[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Vehicle</th>
            <th className="py-2 pr-4 font-medium">Year</th>
            <th className="py-2 pr-4 font-medium text-right">Asking</th>
            <th className="py-2 pr-4 font-medium text-right">Market</th>
            <th className="py-2 pr-4 font-medium text-right">Delta</th>
            <th className="py-2 pr-4 font-medium">Confidence</th>
            <th className="py-2 pr-4 font-medium">KM</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 pr-4 font-medium">Region</th>
            <th className="py-2 pr-4 font-medium">Seen</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => {
            const isFake = l.market_price_source === 'badge_estimate';
            return (
              <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 pr-4 font-medium">
                  {l.make} {l.model}
                  {l.variant_raw && <span className="text-muted-foreground ml-1 text-xs">{l.variant_raw}</span>}
                </td>
                <td className="py-2 pr-4 tabular-nums">{l.year ?? '—'}</td>
                <td className="py-2 pr-4 text-right tabular-nums font-medium">
                  ${l.asking_price.toLocaleString()}
                </td>
                <td className={`py-2 pr-4 text-right tabular-nums ${isFake ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground'}`}>
                  {l.market_price ? `$${l.market_price.toLocaleString()}` : '—'}
                  {isFake && <span className="text-[10px] ml-1">est</span>}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {l.price_difference_percent != null ? (
                    <span className={`font-semibold ${isFake ? 'text-muted-foreground/50' : 'text-green-600 dark:text-green-400'}`}>
                      {l.price_difference_percent.toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 pr-4">
                  <ConfidenceBadge confidence={l.market_confidence} compCount={l.comp_count} />
                </td>
                <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                  {l.km != null ? `${(l.km / 1000).toFixed(0)}k` : '—'}
                </td>
                <td className="py-2 pr-4">
                  <Badge variant="outline" className="text-xs">{l.source}</Badge>
                </td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">{l.region_id ?? '—'}</td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(l.last_seen_at), { addSuffix: true })}
                </td>
                <td className="py-2">
                  {l.listing_url && (
                    <a href={l.listing_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="iconSm">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PriceBadgeSection({
  title,
  color,
  listings,
  isLoading,
  defaultOpen = false,
}: {
  title: string;
  color: 'destructive' | 'warning';
  listings: RetailListing[];
  isLoading: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const realCount = listings.filter(l => l.market_price_source === 'comparable_median').length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {open ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                <CardTitle className="text-lg">{title}</CardTitle>
                <Badge variant={color === 'destructive' ? 'destructive' : 'outline'} className={color === 'warning' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : ''}>
                  {isLoading ? '…' : listings.length} listings
                </Badge>
                {realCount > 0 && (
                  <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400 text-xs">
                    {realCount} real median
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : listings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No listings found.</p>
            ) : (
              <ListingsTable listings={listings} />
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function CarSalesWatchPage() {
  const [realDeals, setRealDeals] = useState<RetailListing[]>([]);
  const [badgeDeals, setBadgeDeals] = useState<RetailListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecomputing, setIsRecomputing] = useState(false);

  useEffect(() => {
    document.title = 'Car Sales Watch | Operator';
    loadListings();
  }, []);

  async function loadListings() {
    setIsLoading(true);
    try {
      const [realRes, badgeRes] = await Promise.all([
        // Real comparable medians — sorted by biggest delta
        supabase
          .from('retail_listings')
          .select('id, make, model, variant_raw, year, asking_price, market_price, km, price_badge, price_difference, price_difference_percent, listing_url, source, seller_type, region_id, first_seen_at, last_seen_at, lifecycle_status, comp_count, market_confidence, market_price_source')
          .eq('market_price_source', 'comparable_median')
          .eq('source', 'carsales')
          .in('lifecycle_status', ['ACTIVE', 'NEW'])
          .lt('price_difference_percent', -5)
          .gte('comp_count', 3)
          .order('price_difference_percent', { ascending: true })
          .limit(200),
        // Badge-estimated (unverified) — still show but marked
        supabase
          .from('retail_listings')
          .select('id, make, model, variant_raw, year, asking_price, market_price, km, price_badge, price_difference, price_difference_percent, listing_url, source, seller_type, region_id, first_seen_at, last_seen_at, lifecycle_status, comp_count, market_confidence, market_price_source')
          .eq('market_price_source', 'badge_estimate')
          .eq('source', 'carsales')
          .ilike('price_badge', 'well below market%')
          .in('lifecycle_status', ['ACTIVE', 'NEW'])
          .order('asking_price', { ascending: true })
          .limit(100),
      ]);

      if (realRes.data) setRealDeals(realRes.data as RetailListing[]);
      if (badgeRes.data) setBadgeDeals(badgeRes.data as RetailListing[]);
    } catch (err) {
      console.error('Failed to load car sales watch data:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function triggerRecompute() {
    setIsRecomputing(true);
    try {
      const { data, error } = await supabase.functions.invoke('recompute-retail-medians', {
        body: { limit: 200 },
      });
      if (error) throw error;
      console.log('Recompute result:', data);
      // Reload after recompute
      await loadListings();
    } catch (err) {
      console.error('Recompute failed:', err);
    } finally {
      setIsRecomputing(false);
    }
  }

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <TrendingDown className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Car Sales Watch</h1>
            <p className="text-sm text-muted-foreground">
              Real comparable median analysis — not badge estimates. Delta = (asking - median) / median.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={triggerRecompute} disabled={isRecomputing}>
              {isRecomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Recompute Medians
            </Button>
            <Button variant="outline" size="sm" onClick={loadListings} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Refresh
            </Button>
          </div>
        </div>

        <PriceBadgeSection
          title="Real Below-Market Deals (Comparable Median)"
          color="destructive"
          listings={realDeals}
          isLoading={isLoading}
          defaultOpen={true}
        />

        <PriceBadgeSection
          title="Badge-Estimated (Unverified — Awaiting Median)"
          color="warning"
          listings={badgeDeals}
          isLoading={isLoading}
          defaultOpen={false}
        />
      </div>
    </OperatorLayout>
  );
}
