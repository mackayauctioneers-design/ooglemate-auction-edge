import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, RefreshCw, TrendingUp } from 'lucide-react';


interface RetailSignal {
  id: string;
  source_type: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant: string | null;
  kms: number | null;
  location: string | null;
  buy_price: number;
  retail_median_price: number | null;
  retail_gap: number | null;
  confidence_tier: string;
  confidence_score: number;
  status: string;
  created_at: string;
}

export default function RetailSignalsPage() {
  useEffect(() => { document.title = 'Retail Signals | Carbitrage'; return () => { document.title = 'Carbitrage'; }; }, []);
  const [signals, setSignals] = useState<RetailSignal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [minDelta, setMinDelta] = useState('3000');
  const [statusFilter, setStatusFilter] = useState('new');

  const loadSignals = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('opportunities')
        .select('*')
        .eq('source_type', 'market_deviation')
        .order('confidence_score', { ascending: false })
        .limit(200);

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (minDelta) {
        query = query.gte('retail_gap', parseInt(minDelta) || 0);
      }

      const { data, error } = await query;
      if (error) throw error;
      setSignals((data as RetailSignal[]) || []);
    } catch (err) {
      console.error('Failed to load retail signals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, minDelta]);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  const updateStatus = async (id: string, newStatus: string) => {
    await supabase.from('opportunities').update({ status: newStatus }).eq('id', id);
    setSignals(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const tierColor = (tier: string) => {
    switch (tier) {
      case 'HIGH': return 'bg-green-600 text-white';
      case 'MEDIUM': return 'bg-amber-500 text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'reviewed': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'purchased': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'ignored': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-green-500" />
              Retail Signals
            </h1>
            <p className="text-muted-foreground mt-1">
              AI-detected under-market retail listings
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={loadSignals} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Min Delta:</span>
            <Input
              type="number"
              value={minDelta}
              onChange={e => setMinDelta(e.target.value)}
              className="w-28"
              placeholder="3000"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="purchased">Purchased</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground ml-auto">
            {signals.length} signal{signals.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Est Retail</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map(s => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{s.year} {s.make} {s.model}</p>
                      {s.variant && <p className="text-xs text-muted-foreground">{s.variant}</p>}
                      {s.kms && <p className="text-xs text-muted-foreground">{s.kms.toLocaleString()} km</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${s.buy_price?.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${s.retail_median_price?.toLocaleString() || '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-green-500">
                    +${s.retail_gap?.toLocaleString() || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={tierColor(s.confidence_tier)}>{s.confidence_tier}</Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={s.status}
                      onValueChange={(v) => updateStatus(s.id, v)}
                    >
                      <SelectTrigger className={`w-28 text-xs h-7 ${statusColor(s.status)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="reviewed">Reviewed</SelectItem>
                        <SelectItem value="purchased">Purchased</SelectItem>
                        <SelectItem value="ignored">Ignored</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    EasyAuto
                  </TableCell>
                  <TableCell>
                    {s.listing_url?.startsWith('http') && (
                      <a
                        href={s.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && signals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    No retail signals yet. Run the EasyAuto scraper to detect under-market listings.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}
