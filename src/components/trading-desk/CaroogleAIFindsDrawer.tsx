import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, ExternalLink, Trophy, TrendingDown, RefreshCw, Loader2, Zap, Gavel, Star, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface CaroogleFind {
  id: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  series: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  median_price: number | null;
  spread: number | null;
  discount_percent: number | null;
  score: number;
  confidence: string;
  reasons: string[];
  flag_types: string[];
  source: string | null;
  location: string | null;
  listing_url: string | null;
  cluster_key: string;
  cluster_size: number;
  avg_days_on_market: number | null;
  is_auction: boolean;
  auction_arbitrage_gap: number | null;
  first_detected_at: string;
  status: string;
};

const fmt = (n: number | null) => n != null ? `$${n.toLocaleString()}` : '-';
const fmtKm = (n: number | null) => n != null ? `${(n / 1000).toFixed(0)}k km` : '';

const confidenceColors: Record<string, string> = {
  HIGH: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  LOW: 'bg-muted text-muted-foreground border-border',
};

const flagIcons: Record<string, React.ReactNode> = {
  CHEAPEST_IN_MARKET: <Trophy className="h-3.5 w-3.5 text-amber-500" />,
  UNDER_MARKET: <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />,
  AUCTION_ARBITRAGE: <Gavel className="h-3.5 w-3.5 text-violet-500" />,
  FAST_MOVER: <Zap className="h-3.5 w-3.5 text-orange-500" />,
};

const flagLabels: Record<string, string> = {
  CHEAPEST_IN_MARKET: 'Cheapest',
  UNDER_MARKET: 'Under Market',
  AUCTION_ARBITRAGE: 'Auction Arb',
  FAST_MOVER: 'Fast Mover',
};

export function CaroogleAIFindsDrawer() {
  const [open, setOpen] = useState(false);
  const [finds, setFinds] = useState<CaroogleFind[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [viewFilter, setViewFilter] = useState<'active' | 'starred'>('active');

  const fetchFinds = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('caroogle_finds')
        .select('*')
        .in('status', ['active', 'starred'])
        .gte('score', 40)
        .order('score', { ascending: false })
        .limit(100);
      if (error) throw error;
      setFinds((data as CaroogleFind[]) || []);
    } catch (err) {
      console.error('Failed to load finds:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchFinds();
  }, [open, fetchFinds]);

  const runScanner = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-scanner');
      if (error) throw error;
      toast.success(`Scanned ${data?.clusters_scanned || 0} clusters → ${data?.finds_created || 0} finds`);
      fetchFinds();
    } catch (err: any) {
      toast.error(err.message || 'Scanner failed');
    } finally {
      setScanning(false);
    }
  };

  const toggleStar = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'starred' ? 'active' : 'starred';
    const { error } = await supabase.from('caroogle_finds').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setFinds(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f));
    toast.success(newStatus === 'starred' ? 'Starred — watching closely' : 'Unstarred');
  };

  const dismissFind = async (id: string) => {
    const { error } = await supabase.from('caroogle_finds').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setFinds(prev => prev.filter(f => f.id !== id));
    toast.success('Dismissed');
  };

  const filtered = finds.filter(f => viewFilter === 'starred' ? f.status === 'starred' : true);
  const starredCount = finds.filter(f => f.status === 'starred').length;
  const totalCount = finds.filter(f => f.status === 'active').length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border font-medium transition-all border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 ${finds.length > 0 ? 'ring-2 ring-offset-1 ring-amber-500 shadow-md scale-105' : 'opacity-80 hover:opacity-100'}`}>
          <Sparkles className="h-4 w-4" />
          <span className="text-xl font-bold">{finds.length}</span>
          <span className="text-[11px] uppercase tracking-wide">AI FINDS</span>
          {starredCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] ml-1">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              {starredCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              CarOogle Finds
            </SheetTitle>
            <Button size="sm" variant="outline" onClick={runScanner} disabled={scanning}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Automatically detected market opportunities
          </p>

          {/* Filter tabs */}
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant={viewFilter === 'active' ? 'default' : 'outline'} onClick={() => setViewFilter('active')} className="text-xs h-7">
              All ({totalCount + starredCount})
            </Button>
            <Button size="sm" variant={viewFilter === 'starred' ? 'default' : 'outline'} onClick={() => setViewFilter('starred')} className="text-xs h-7">
              <Star className="h-3 w-3 mr-1" /> Starred ({starredCount})
            </Button>
          </div>

          {/* Summary strip */}
          {!loading && finds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {(['CHEAPEST_IN_MARKET', 'UNDER_MARKET', 'AUCTION_ARBITRAGE', 'FAST_MOVER'] as const).map(ft => {
                const count = filtered.filter(f => f.flag_types?.includes(ft)).length;
                if (count === 0) return null;
                return (
                  <span key={ft} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[10px] font-medium text-muted-foreground">
                    {flagIcons[ft]} {count} {flagLabels[ft]}
                  </span>
                );
              })}
            </div>
          )}
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{viewFilter === 'starred' ? 'No starred finds' : 'No active finds'}</p>
            <p className="text-sm mt-1">{viewFilter === 'starred' ? 'Star finds to watch them closely' : 'Run the scanner to detect market opportunities'}</p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {filtered.map(find => (
              <FindCard key={find.id} find={find} onToggleStar={toggleStar} onDismiss={dismissFind} />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FindCard({ find, onToggleStar, onDismiss }: { find: CaroogleFind; onToggleStar: (id: string, status: string) => void; onDismiss: (id: string) => void }) {
  const vehicle = `${find.year || ''} ${find.make || ''} ${find.model || ''} ${find.variant || ''}`.trim();
  const isStarred = find.status === 'starred';

  return (
    <div className={`rounded-lg border bg-card p-3 space-y-2 ${isStarred ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-border'}`}>
      {/* Header: vehicle + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-foreground truncate">{vehicle || 'Unknown vehicle'}</p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            {find.source && <span className="capitalize">{find.source}</span>}
            {find.location && <span>• {find.location}</span>}
            {find.km && <span>• {fmtKm(find.km)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className={`text-[10px] font-bold ${confidenceColors[find.confidence] || ''}`}>
            {find.score}
          </Badge>
          <Button variant="ghost" size="iconSm" onClick={() => onToggleStar(find.id, find.status)} title={isStarred ? 'Unstar' : 'Star to watch'}>
            <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground'}`} />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={() => onDismiss(find.id)} title="Dismiss">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </Button>
          {find.listing_url && (
            <a href={find.listing_url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="iconSm">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Price row */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-bold text-foreground text-sm">{fmt(find.price)}</span>
        {find.median_price && (
          <span className="text-muted-foreground">
            Market {fmt(find.median_price)}
          </span>
        )}
        {find.spread != null && find.spread > 0 && (
          <span className="text-muted-foreground">
            Spread {fmt(find.spread)}
          </span>
        )}
      </div>

      {/* Flag badges */}
      <div className="flex flex-wrap gap-1.5">
        {find.flag_types?.map(ft => (
          <span
            key={ft}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
              ft === 'CHEAPEST_IN_MARKET'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : ft === 'UNDER_MARKET'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : ft === 'AUCTION_ARBITRAGE'
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-700'
                : 'border-orange-500/30 bg-orange-500/10 text-orange-700'
            }`}
          >
            {flagIcons[ft]}
            {flagLabels[ft]}
            {ft === 'UNDER_MARKET' && find.discount_percent != null && ` ${find.discount_percent}%`}
            {ft === 'AUCTION_ARBITRAGE' && find.auction_arbitrage_gap != null && ` ${fmt(find.auction_arbitrage_gap)}`}
          </span>
        ))}
      </div>

      {/* Reasons */}
      <div className="text-[10px] text-muted-foreground space-y-0.5">
        {find.reasons?.map((r, i) => (
          <p key={i}>• {r}</p>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
        <span>{find.cluster_size} in cluster{find.avg_days_on_market ? ` • avg ${find.avg_days_on_market}d` : ''}</span>
        <span>{formatDistanceToNow(new Date(find.first_detected_at), { addSuffix: true })}</span>
      </div>
    </div>
  );
}
