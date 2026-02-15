import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, RefreshCw, AlertTriangle, TrendingUp } from 'lucide-react';

interface Signal {
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
  dealer_median_price: number | null;
  deviation: number | null;
  retail_gap: number | null;
  priority_level: number | null;
  status: string;
  created_at: string;
}

export default function RetailSignalsPage() {
  useEffect(() => { document.title = 'Opportunities | Carbitrage'; return () => { document.title = 'Carbitrage'; }; }, []);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [minDelta, setMinDelta] = useState('3000');
  const [statusFilter, setStatusFilter] = useState('new');
  const [sourceFilter, setSourceFilter] = useState('all');

  const loadSignals = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('opportunities')
        .select('*')
        .in('source_type', ['replication', 'retail_deviation', 'market_deviation', 'winner_replication'])
        .order('priority_level', { ascending: true, nullsFirst: false })
        .order('deviation', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false })
        .limit(200);

      if (statusFilter && statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (sourceFilter && sourceFilter !== 'all') query = query.eq('source_type', sourceFilter);
      if (minDelta) query = query.gte('deviation', parseInt(minDelta) || 0);

      const { data, error } = await query;
      if (error) throw error;
      setSignals((data as Signal[]) || []);
    } catch (err) {
      console.error('Failed to load signals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, sourceFilter, minDelta]);

  useEffect(() => { loadSignals(); }, [loadSignals]);

  const updateStatus = async (id: string, newStatus: string) => {
    await supabase.from('opportunities').update({ status: newStatus }).eq('id', id);
    setSignals(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const isCodeRed = (s: Signal) => s.priority_level === 1;

  const sourceLabel = (t: string) => {
    switch (t) {
      case 'replication': return 'Historical';
      case 'retail_deviation': return 'Retail AI';
      case 'market_deviation': return 'Market AI';
      case 'winner_replication': return '🏆 Winner';
      default: return t;
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
              Opportunities
            </h1>
            <p className="text-muted-foreground mt-1">
              Under-market signals — sorted by priority, then delta
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={loadSignals} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Min Delta:</span>
            <Input type="number" value={minDelta} onChange={e => setMinDelta(e.target.value)} className="w-28" placeholder="3000" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Source:</span>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="replication">Historical</SelectItem>
                <SelectItem value="retail_deviation">Retail AI</SelectItem>
                <SelectItem value="market_deviation">Market AI</SelectItem>
                <SelectItem value="winner_replication">🏆 Winner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="purchased">Purchased</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground ml-auto">{signals.length} signal{signals.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map(s => (
                <TableRow key={s.id} className={isCodeRed(s) ? 'bg-red-500/5 border-l-2 border-l-red-500' : ''}>
                  <TableCell>
                    {isCodeRed(s) && <AlertTriangle className="h-4 w-4 text-red-500" />}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className={`font-medium ${isCodeRed(s) ? 'text-red-400' : ''}`}>
                        {s.year} {s.make} {s.model}
                      </p>
                      {s.variant && <p className="text-xs text-muted-foreground">{s.variant}</p>}
                      {s.kms && <p className="text-xs text-muted-foreground">{s.kms.toLocaleString()} km</p>}
                      {s.location && <p className="text-xs text-muted-foreground">{s.location}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${s.buy_price?.toLocaleString()}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-bold ${isCodeRed(s) ? 'text-red-400' : 'text-green-500'}`}>
                    +${(s.deviation || s.retail_gap || 0).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {sourceLabel(s.source_type)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select value={s.status} onValueChange={(v) => updateStatus(s.id, v)}>
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
                  <TableCell>
                    {s.listing_url?.startsWith('http') && (
                      <a href={s.listing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && signals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No signals yet. Run the scrapers to detect under-market listings.
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
