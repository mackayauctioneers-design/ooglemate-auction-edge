import { useState, useEffect } from 'react';
import { TrapListing } from '@/pages/TrapInventoryPage';
import { supabase } from '@/integrations/supabase/client';
import { useTrapWatchlist } from '@/hooks/useTrapWatchlist';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { 
  ExternalLink, 
  Calendar, 
  Gauge, 
  MapPin, 
  Store,
  TrendingDown,
  TrendingUp,
  Eye,
  Pin,
  Loader2,
  Clock,
  Save,
  StickyNote
} from 'lucide-react';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface TrapInventoryDrawerProps {
  listing: TrapListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotesChange?: () => void;
}

interface PriceSnapshot {
  seen_at: string;
  asking_price: number | null;
}

const formatCurrency = (val: number | null) => {
  if (val === null) return '-';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);
};

const formatNumber = (val: number | null) => {
  if (val === null) return '-';
  return new Intl.NumberFormat('en-AU').format(val);
};

const getStatusBadge = (days: number) => {
  if (days <= 14) {
    return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Fresh</Badge>;
  } else if (days <= 60) {
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Sticky</Badge>;
  } else if (days <= 90) {
    return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30">Softening</Badge>;
  } else {
    return <Badge variant="destructive">90+ days</Badge>;
  }
};

const getDealBadge = (dealLabel: string) => {
  switch (dealLabel) {
    case 'MISPRICED':
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Mispriced</Badge>;
    case 'STRONG_BUY':
      return <Badge className="bg-emerald-500 hover:bg-emerald-500">Strong Buy</Badge>;
    case 'WATCH':
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Watch</Badge>;
    default:
      return null;
  }
};

export function TrapInventoryDrawer({ listing, open, onOpenChange, onNotesChange }: TrapInventoryDrawerProps) {
  const [priceHistory, setPriceHistory] = useState<PriceSnapshot[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [localNotes, setLocalNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  
  // Use watchlist hook for persistence
  const { 
    isWatching, 
    isPinned, 
    notes,
    loading: watchlistLoading,
    toggleWatch, 
    togglePin,
    updateNotes
  } = useTrapWatchlist(listing?.id ?? null);

  // Sync local notes with hook notes
  useEffect(() => {
    setLocalNotes(notes || '');
    setNotesDirty(false);
  }, [notes, listing?.id]);

  useEffect(() => {
    if (listing && open) {
      fetchPriceHistory(listing.id);
    }
  }, [listing, open]);

  const fetchPriceHistory = async (listingId: string) => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from('listing_snapshots')
      .select('seen_at, asking_price')
      .eq('listing_id', listingId)
      .order('seen_at', { ascending: true });

    if (error) {
      console.error('Error fetching price history:', error);
    } else {
      setPriceHistory(data || []);
    }
    setLoadingHistory(false);
  };

  if (!listing) return null;

  const chartData = priceHistory
    .filter(p => p.asking_price !== null)
    .map(p => ({
      date: format(new Date(p.seen_at), 'dd MMM'),
      price: p.asking_price,
    }));

  const getTrapName = (source: string) => {
    return source.replace(/^trap_/, '').replace(/_/g, ' ');
  };

  const dealBadge = getDealBadge(listing.deal_label);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg bg-card border-l border-border overflow-y-auto">
        <SheetHeader className="space-y-4 pb-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getStatusBadge(listing.days_on_market)}
              {dealBadge}
            </div>
            <span className="text-sm text-muted-foreground">
              {listing.days_on_market} days on market
            </span>
          </div>
          
          <SheetTitle className="text-left">
            <span className="text-2xl font-bold text-foreground">
              {listing.year} {listing.make} {listing.model}
            </span>
            {listing.variant_family && (
              <p className="text-base font-normal text-muted-foreground mt-1">
                {listing.variant_family}
              </p>
            )}
          </SheetTitle>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Store className="h-4 w-4" />
              {getTrapName(listing.source)}
            </span>
            {listing.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {listing.location}
              </span>
            )}
            {listing.km && (
              <span className="flex items-center gap-1.5">
                <Gauge className="h-4 w-4" />
                {formatNumber(listing.km)} km
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Listed {format(new Date(listing.first_seen_at), 'dd MMM yyyy')}
            </span>
          </div>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Current Price & Benchmark */}
          <section className="grid grid-cols-2 gap-4">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Price</p>
              <p className="text-2xl font-bold text-foreground mono">{formatCurrency(listing.asking_price)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Benchmark</p>
              {listing.no_benchmark ? (
                <p className="text-xl font-bold text-muted-foreground opacity-50">No data</p>
              ) : (
                <p className="text-xl font-bold text-muted-foreground mono">{formatCurrency(listing.benchmark_price)}</p>
              )}
            </div>
            
            {/* Delta vs Benchmark */}
            {!listing.no_benchmark && listing.delta_pct !== null && (
              <div className={`stat-card col-span-2 ${listing.delta_pct < 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <p className={`text-xs uppercase tracking-wide flex items-center gap-1 ${listing.delta_pct < 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {listing.delta_pct < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                  {listing.delta_pct < 0 ? 'Under Benchmark' : 'Over Benchmark'}
                </p>
                <div className="flex items-baseline gap-2">
                  <p className={`text-xl font-bold mono ${listing.delta_pct < 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {listing.delta_pct > 0 ? '+' : ''}{listing.delta_pct.toFixed(1)}%
                  </p>
                  <span className={`text-sm ${listing.delta_pct < 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    ({formatCurrency(Math.abs(listing.delta_dollars ?? 0))})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {listing.benchmark_sample} cleared sales
                  {listing.benchmark_ttd && ` • Avg ${Math.round(listing.benchmark_ttd)} days to clear`}
                </p>
              </div>
            )}

            {/* Price changes */}
            {listing.price_change_count > 0 && (
              <div className="stat-card col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Price Changes
                </p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-bold text-foreground">
                    {listing.price_change_count} change{listing.price_change_count !== 1 ? 's' : ''}
                  </p>
                  {listing.first_price && listing.asking_price && listing.first_price !== listing.asking_price && (
                    <span className="text-sm text-muted-foreground">
                      {formatCurrency(listing.first_price)} → {formatCurrency(listing.asking_price)}
                    </span>
                  )}
                </div>
                {listing.last_price_change_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last changed {format(new Date(listing.last_price_change_at), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* Price History Chart */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3">Price History</h3>
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : chartData.length > 1 ? (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value), 'Price']}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    {!listing.no_benchmark && listing.benchmark_price && (
                      <ReferenceLine 
                        y={listing.benchmark_price} 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeDasharray="5 5"
                        label={{ 
                          value: 'Benchmark', 
                          position: 'right',
                          fontSize: 10,
                          fill: 'hsl(var(--muted-foreground))'
                        }}
                      />
                    )}
                    <Line 
                      type="stepAfter" 
                      dataKey="price" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {chartData.length === 1 ? 'Only one price point recorded' : 'No price history available'}
              </div>
            )}
          </section>

          <Separator />

          {/* Watch / Pin Toggles */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Monitoring</h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="watch-toggle" className="text-sm">Watch this listing</Label>
              </div>
              <Switch 
                id="watch-toggle"
                checked={isWatching}
                onCheckedChange={toggleWatch}
                disabled={watchlistLoading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pin className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="pin-toggle" className="text-sm">Pin to top</Label>
              </div>
              <Switch 
                id="pin-toggle"
                checked={isPinned}
                onCheckedChange={togglePin}
                disabled={watchlistLoading}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {watchlistLoading ? 'Saving...' : 'Saved to your watchlist'}
            </p>
            
            {/* Notes */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">Notes</Label>
              </div>
              <Textarea
                placeholder="Add notes about this listing..."
                value={localNotes}
                onChange={(e) => {
                  setLocalNotes(e.target.value);
                  setNotesDirty(e.target.value !== (notes || ''));
                }}
                className="min-h-[80px] text-sm"
              />
              <Button
                size="sm"
                variant={notesDirty ? 'default' : 'outline'}
                disabled={!notesDirty || savingNotes}
                onClick={async () => {
                  setSavingNotes(true);
                  await updateNotes(localNotes);
                  setNotesDirty(false);
                  setSavingNotes(false);
                  onNotesChange?.();
                }}
                className="w-full"
              >
                {savingNotes ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {savingNotes ? 'Saving...' : notesDirty ? 'Save Notes' : 'Notes saved'}
              </Button>
            </div>
          </section>

          <Separator />

          {/* Actions */}
          <section>
            {listing.listing_url ? (
              <Button asChild className="w-full" variant="outline">
                <a href={listing.listing_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open Listing
                </a>
              </Button>
            ) : (
              <Button className="w-full opacity-50 cursor-not-allowed" variant="secondary" disabled>
                <ExternalLink className="h-4 w-4" />
                No Listing URL
              </Button>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
