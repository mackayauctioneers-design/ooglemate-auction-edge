import { useEffect, useState, useCallback } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, RefreshCw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface OperatorOpportunity {
  id: string;
  listing_id: string;
  listing_source: string | null;
  source_url: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  best_account_id: string | null;
  best_account_name: string | null;
  best_expected_margin: number | null;
  best_under_buy: number | null;
  alt_matches: any[];
  tier: string;
  status: string;
  assigned_to_name: string | null;
  days_listed: number | null;
  freshness: string | null;
  created_at: string;
  updated_at: string;
}

type SortField = 'best_expected_margin' | 'best_under_buy' | 'asking_price' | 'year' | 'created_at' | 'tier';

const tierOrder: Record<string, number> = { CODE_RED: 0, HIGH: 1, BUY: 2, WATCH: 3 };
const tierColors: Record<string, string> = {
  CODE_RED: 'bg-destructive text-destructive-foreground',
  HIGH: 'bg-primary text-primary-foreground',
  BUY: 'bg-accent text-accent-foreground',
  WATCH: 'bg-muted text-muted-foreground',
};

export default function TradingDeskPage() {
  const [opportunities, setOpportunities] = useState<OperatorOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; display_name: string }[]>([]);

  // Filters
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterMinMargin, setFilterMinMargin] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('active'); // active = new+reviewed

  // Sort
  const [sortField, setSortField] = useState<SortField>('best_expected_margin');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => { document.title = 'Trading Desk | Operator'; }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [oppsRes, acctsRes] = await Promise.all([
        supabase
          .from('operator_opportunities')
          .select('*')
          .order('best_expected_margin', { ascending: false })
          .limit(500),
        supabase.from('accounts').select('id, display_name'),
      ]);

      if (oppsRes.error) throw oppsRes.error;
      setOpportunities((oppsRes.data as OperatorOpportunity[]) || []);
      setAccounts((acctsRes.data || []) as { id: string; display_name: string }[]);
    } catch (err) {
      console.error('Failed to load trading desk:', err);
      toast.error('Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runScoring = async () => {
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('score-operator-opportunities');
      if (error) throw error;
      toast.success(`Scored ${data?.scored || 0} opportunities from ${data?.candidates || 0} listings`);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Scoring failed');
    } finally {
      setScoring(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string, assignTo?: string) => {
    const update: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (assignTo) {
      const acct = accounts.find(a => a.id === assignTo);
      update.assigned_to_account = assignTo;
      update.assigned_to_name = acct?.display_name || assignTo;
      update.assigned_at = new Date().toISOString();
    }
    const { error } = await supabase.from('operator_opportunities').update(update).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Status → ${newStatus}`);
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, ...update } : o));
  };

  // ─── Filter + Sort ──────────────────────────────────────────────────────────

  const filtered = opportunities.filter(o => {
    if (filterStatus === 'active' && !['new', 'reviewed'].includes(o.status)) return false;
    if (filterStatus !== 'all' && filterStatus !== 'active' && o.status !== filterStatus) return false;
    if (filterAccount !== 'all' && o.best_account_id !== filterAccount) return false;
    if (filterTier !== 'all' && o.tier !== filterTier) return false;
    if (filterSource !== 'all' && o.listing_source !== filterSource) return false;
    if (filterMinMargin) {
      const min = Number(filterMinMargin);
      if (!isNaN(min) && (o.best_expected_margin || 0) < min) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let aVal: number, bVal: number;
    if (sortField === 'tier') {
      aVal = tierOrder[a.tier] ?? 99;
      bVal = tierOrder[b.tier] ?? 99;
    } else if (sortField === 'created_at') {
      aVal = new Date(a.created_at).getTime();
      bVal = new Date(b.created_at).getTime();
    } else {
      aVal = (a[sortField] as number) ?? 0;
      bVal = (b[sortField] as number) ?? 0;
    }
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;
  };

  const uniqueSources = [...new Set(opportunities.map(o => o.listing_source).filter(Boolean))] as string[];

  // ─── KPI Cards ──────────────────────────────────────────────────────────────

  const codeRedCount = opportunities.filter(o => o.tier === 'CODE_RED' && ['new', 'reviewed'].includes(o.status)).length;
  const highCount = opportunities.filter(o => o.tier === 'HIGH' && ['new', 'reviewed'].includes(o.status)).length;
  const buyCount = opportunities.filter(o => o.tier === 'BUY' && ['new', 'reviewed'].includes(o.status)).length;
  const watchCount = opportunities.filter(o => o.tier === 'WATCH' && ['new', 'reviewed'].includes(o.status)).length;

  const fmt = (n: number | null) => n != null ? `$${n.toLocaleString()}` : '-';
  const fmtKm = (n: number | null) => n != null ? `${(n / 1000).toFixed(0)}k` : '-';

  return (
    <OperatorLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trading Desk</h1>
            <p className="text-muted-foreground text-sm">Centralised multi-dealer opportunity board</p>
          </div>
          <Button onClick={runScoring} disabled={scoring} variant="default">
            {scoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {scoring ? 'Scoring…' : 'Run Scoring'}
          </Button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{codeRedCount}</p>
              <p className="text-xs text-muted-foreground">CODE RED</p>
            </CardContent>
          </Card>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-primary">{highCount}</p>
              <p className="text-xs text-muted-foreground">HIGH</p>
            </CardContent>
          </Card>
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-accent-foreground">{buyCount}</p>
              <p className="text-xs text-muted-foreground">BUY</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{watchCount}</p>
              <p className="text-xs text-muted-foreground">WATCH</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-40">
            <label className="text-xs text-muted-foreground mb-1 block">Account</label>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Tier</label>
            <Select value={filterTier} onValueChange={setFilterTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="CODE_RED">CODE RED</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="WATCH">WATCH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <label className="text-xs text-muted-foreground mb-1 block">Source</label>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {uniqueSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">New + Reviewed</SelectItem>
                <SelectItem value="new">New Only</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="bought">Bought</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <label className="text-xs text-muted-foreground mb-1 block">Min Margin $</label>
            <Input type="number" value={filterMinMargin} onChange={e => setFilterMinMargin(e.target.value)} placeholder="0" />
          </div>
        </div>

        {/* Results Count */}
        <p className="text-sm text-muted-foreground">{sorted.length} opportunities</p>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">No opportunities yet. Hit "Run Scoring" to populate.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="cursor-pointer" onClick={() => handleSort('tier')}>Tier <SortIcon field="tier" /></TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('asking_price')}>Ask <SortIcon field="asking_price" /></TableHead>
                    <TableHead>Best Account</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('best_expected_margin')}>Margin <SortIcon field="best_expected_margin" /></TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('best_under_buy')}>Under-Buy <SortIcon field="best_under_buy" /></TableHead>
                    <TableHead>Alt Dealers</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('year')}>Year <SortIcon field="year" /></TableHead>
                    <TableHead className="text-right">KM</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(opp => (
                    <TableRow key={opp.id} className="border-b border-border">
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${tierColors[opp.tier] || 'bg-muted text-muted-foreground'}`}>
                          {opp.tier.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{opp.make} {opp.model}</p>
                          <p className="text-xs text-muted-foreground">{opp.variant}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmt(opp.asking_price)}</TableCell>
                      <TableCell>
                        <span className="text-sm font-medium text-primary">{opp.best_account_name || '-'}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono font-semibold text-primary">{fmt(opp.best_expected_margin)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-sm ${(opp.best_under_buy || 0) >= 1500 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {fmt(opp.best_under_buy)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(opp.alt_matches || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(opp.alt_matches as any[]).slice(0, 2).map((m: any, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {m.account_name}: {fmt(m.expected_margin)}
                              </Badge>
                            ))}
                            {(opp.alt_matches as any[]).length > 2 && (
                              <Badge variant="outline" className="text-xs">+{(opp.alt_matches as any[]).length - 2}</Badge>
                            )}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{opp.listing_source}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{opp.year}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtKm(opp.km)}</TableCell>
                      <TableCell>
                        <Badge variant={opp.status === 'new' ? 'default' : 'outline'} className="text-xs">
                          {opp.assigned_to_name ? `→ ${opp.assigned_to_name}` : opp.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Assign to accounts */}
                          {accounts.map(a => (
                            <Button
                              key={a.id}
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 px-2"
                              title={`Assign to ${a.display_name}`}
                              onClick={() => updateStatus(opp.id, 'assigned', a.id)}
                            >
                              {a.display_name.split(' ')[0]}
                            </Button>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => updateStatus(opp.id, 'ignored')}>✕</Button>
                          {opp.source_url && (
                            <Button variant="ghost" size="iconSm" asChild>
                              <a href={opp.source_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
