import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ExternalLink, RefreshCw, Target, TrendingUp, Eye, ShoppingCart, Ban } from 'lucide-react';
import { KitingWingMarkVideo } from '@/components/kiting';
import { toast } from 'sonner';

type OpportunityStatus = 'new' | 'reviewed' | 'ignored' | 'purchased' | 'expired';
type SourceType = 'buy_now' | 'auction' | 'fingerprint' | 'market_deviation';

interface Opportunity {
  id: string;
  created_at: string;
  source_type: SourceType;
  listing_url: string;
  stock_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  kms: number | null;
  location: string | null;
  buy_price: number | null;
  dealer_median_price: number | null;
  deviation: number | null;
  grok_wholesale_estimate: number | null;
  grok_gap: number | null;
  flip_count: number | null;
  median_profit: number | null;
  pattern_strong: boolean | null;
  confidence_score: number;
  confidence_tier: string;
  status: OpportunityStatus;
}

function fmtMoney(n: number | null) {
  if (n == null) return '-';
  return '$' + Math.round(n).toLocaleString();
}

const SOURCE_LABELS: Record<string, string> = {
  buy_now: 'Buy Now',
  auction: 'Auction',
  fingerprint: 'Fingerprint',
  market_deviation: 'Market Dev',
};

const TIER_COLORS: Record<string, string> = {
  HIGH: 'bg-primary text-primary-foreground',
  MEDIUM: 'bg-accent text-accent-foreground',
  LOW: 'bg-muted text-muted-foreground',
};

export default function UnifiedOpportunitiesPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const { data: opportunities = [], isLoading, refetch } = useQuery({
    queryKey: ['unified-opportunities', statusFilter, sourceFilter],
    queryFn: async () => {
      let query = supabase
        .from('opportunities')
        .select('*')
        .order('confidence_score', { ascending: false })
        .limit(200);

      if (statusFilter === 'active') {
        query = query.in('status', ['new', 'reviewed']);
      } else if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (sourceFilter !== 'all') {
        query = query.eq('source_type', sourceFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Opportunity[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OpportunityStatus }) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-opportunities'] });
      toast.success('Status updated');
    },
  });

  const newCount = opportunities.filter(o => o.status === 'new').length;
  const reviewedCount = opportunities.filter(o => o.status === 'reviewed').length;
  const avgDeviation = opportunities.length > 0
    ? Math.round(opportunities.reduce((s, o) => s + (o.deviation || 0), 0) / opportunities.length)
    : 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KitingWingMarkVideo size={48} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Opportunities</h1>
              <p className="text-muted-foreground">{opportunities.length} results</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">New</p>
              <p className="text-2xl font-bold text-primary mono">{newCount}</p>
            </div>
          </div>
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent/10">
              <Eye className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Reviewed</p>
              <p className="text-2xl font-bold mono">{reviewedCount}</p>
            </div>
          </div>
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Deviation</p>
              <p className="text-2xl font-bold mono">{fmtMoney(avgDeviation)}</p>
            </div>
          </div>
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <ShoppingCart className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold mono">{opportunities.length}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">New + Reviewed</SelectItem>
              <SelectItem value="new">New Only</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="purchased">Purchased</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="buy_now">Buy Now</SelectItem>
              <SelectItem value="auction">Auction</SelectItem>
              <SelectItem value="fingerprint">Fingerprint</SelectItem>
              <SelectItem value="market_deviation">Market Dev</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="table-header-cell">Status</TableHead>
                  <TableHead className="table-header-cell">Source</TableHead>
                  <TableHead className="table-header-cell">Vehicle</TableHead>
                  <TableHead className="table-header-cell text-right">Buy Price</TableHead>
                  <TableHead className="table-header-cell text-right">Deviation</TableHead>
                  <TableHead className="table-header-cell text-right">AI Gap</TableHead>
                  <TableHead className="table-header-cell text-right">Dealer Median</TableHead>
                  <TableHead className="table-header-cell text-right">Flips</TableHead>
                  <TableHead className="table-header-cell text-center">Tier</TableHead>
                  <TableHead className="table-header-cell text-center">Date</TableHead>
                  <TableHead className="table-header-cell text-center">Actions</TableHead>
                  <TableHead className="table-header-cell text-right">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={12}><div className="h-10 bg-muted rounded animate-pulse" /></TableCell>
                    </TableRow>
                  ))
                ) : opportunities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                      No opportunities match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  opportunities.map((opp) => (
                    <TableRow key={opp.id} className="border-b border-border">
                      <TableCell>
                        <Badge variant={opp.status === 'new' ? 'default' : 'outline'} className="text-xs">
                          {opp.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {SOURCE_LABELS[opp.source_type] || opp.source_type}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">
                            {opp.year} {opp.make} {opp.model}
                          </p>
                          {opp.variant && (
                            <p className="text-xs text-muted-foreground">{opp.variant}</p>
                          )}
                          {opp.kms && (
                            <p className="text-xs text-muted-foreground">{opp.kms.toLocaleString()} km</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right mono font-semibold">
                        {fmtMoney(opp.buy_price)}
                      </TableCell>
                      <TableCell className="text-right mono font-semibold text-primary">
                        {opp.deviation ? '+' + fmtMoney(opp.deviation) : '-'}
                      </TableCell>
                      <TableCell className="text-right mono text-sm">
                        {opp.grok_gap ? '+' + fmtMoney(opp.grok_gap) : '-'}
                      </TableCell>
                      <TableCell className="text-right mono text-sm text-muted-foreground">
                        {fmtMoney(opp.dealer_median_price)}
                      </TableCell>
                      <TableCell className="text-right mono text-sm">
                        {opp.flip_count ?? '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={`text-xs ${TIER_COLORS[opp.confidence_tier] || ''}`}>
                          {opp.confidence_tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground mono">
                        {new Date(opp.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex gap-1 justify-center">
                          {opp.status === 'new' && (
                            <Button
                              variant="ghost" size="iconSm"
                              onClick={() => updateStatus.mutate({ id: opp.id, status: 'reviewed' })}
                              title="Mark reviewed"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(opp.status === 'new' || opp.status === 'reviewed') && (
                            <>
                              <Button
                                variant="ghost" size="iconSm"
                                onClick={() => updateStatus.mutate({ id: opp.id, status: 'purchased' })}
                                title="Mark purchased"
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="iconSm"
                                onClick={() => updateStatus.mutate({ id: opp.id, status: 'ignored' })}
                                title="Ignore"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="iconSm" asChild>
                          <a href={opp.listing_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}