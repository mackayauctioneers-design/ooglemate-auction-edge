import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ExternalLink, Trophy, TrendingDown, RefreshCw, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface DealFlag {
  id: string;
  listing_id: string;
  flag_type: string;
  confidence: number;
  price: number | null;
  price_gap: number | null;
  price_gap_pct: number | null;
  market_spread: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  source: string | null;
  location: string | null;
  listing_url: string | null;
  cluster_key: string;
  cluster_size: number;
  created_at: string;
  expires_at: string;
}

const fmt = (n: number | null) => n != null ? `$${n.toLocaleString()}` : '-';
const fmtKm = (n: number | null) => n != null ? `${(n / 1000).toFixed(0)}k km` : '';

export function CaroogleAIFindsDrawer() {
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<DealFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('deal_flags')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setFlags((data as DealFlag[]) || []);
    } catch (err) {
      console.error('Failed to load deal flags:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchFlags();
  }, [open, fetchFlags]);

  const runScanner = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-scanner');
      if (error) throw error;
      toast.success(`Scanned ${data?.clusters_scanned || 0} clusters, flagged ${data?.flags_created || 0} deals`);
      fetchFlags();
    } catch (err: any) {
      toast.error(err.message || 'Scanner failed');
    } finally {
      setScanning(false);
    }
  };

  const cheapest = flags.filter(f => f.flag_type === 'CHEAPEST_IN_MARKET');
  const underMarket = flags.filter(f => f.flag_type === 'UNDER_MARKET');
  const totalCount = flags.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="relative gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          CaroogleAI Finds
          {totalCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
              {totalCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              CaroogleAI Finds
            </SheetTitle>
            <Button size="sm" variant="outline" onClick={runScanner} disabled={scanning}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Market leader & undervalued detections from the opportunity engine
          </p>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : flags.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No active flags</p>
            <p className="text-sm mt-1">Run the scanner to detect market opportunities</p>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Cheapest in Market */}
            {cheapest.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-foreground">Cheapest in Market</h3>
                  <Badge variant="secondary" className="text-[10px]">{cheapest.length}</Badge>
                </div>
                {cheapest.map(flag => (
                  <FlagCard key={flag.id} flag={flag} />
                ))}
              </div>
            )}

            {/* Under Market */}
            {underMarket.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold text-foreground">Under Market Value</h3>
                  <Badge variant="secondary" className="text-[10px]">{underMarket.length}</Badge>
                </div>
                {underMarket.map(flag => (
                  <FlagCard key={flag.id} flag={flag} />
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FlagCard({ flag }: { flag: DealFlag }) {
  const vehicle = `${flag.year || ''} ${flag.make || ''} ${flag.model || ''} ${flag.variant || ''}`.trim();
  const isCheapest = flag.flag_type === 'CHEAPEST_IN_MARKET';

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      isCheapest
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-emerald-500/30 bg-emerald-500/5'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{vehicle || 'Unknown vehicle'}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {flag.source && <span>{flag.source}</span>}
            {flag.location && <span>• {flag.location}</span>}
            {flag.km && <span>• {fmtKm(flag.km)}</span>}
          </div>
        </div>
        {flag.listing_url && (
          <a href={flag.listing_url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="iconSm">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="font-semibold text-foreground">{fmt(flag.price)}</span>
        {isCheapest && flag.market_spread != null && (
          <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30 text-[10px]">
            🏆 {fmt(flag.market_spread)} under next
          </Badge>
        )}
        {!isCheapest && flag.price_gap_pct != null && (
          <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 text-[10px]">
            📉 {Math.abs(flag.price_gap_pct).toFixed(0)}% under market
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{flag.cluster_size} in cluster • {(flag.confidence * 100).toFixed(0)}% confidence</span>
        <span>{formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}</span>
      </div>
    </div>
  );
}
