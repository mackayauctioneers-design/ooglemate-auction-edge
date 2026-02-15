import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Trophy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAccounts } from '@/hooks/useAccounts';

interface Winner {
  id: string;
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  year_min: number | null;
  year_max: number | null;
  total_profit: number;
  avg_profit: number;
  times_sold: number;
  last_sale_price: number;
  last_sale_date: string | null;
  rank: number;
  updated_at: string;
}

export default function WinnersWatchlistPage() {
  useEffect(() => { document.title = 'Proven Winners | Carbitrage'; return () => { document.title = 'Carbitrage'; }; }, []);
  const { data: accounts = [] } = useAccounts();
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [winners, setWinners] = useState<Winner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Auto-select first account
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  const load = useCallback(async () => {
    if (!selectedAccount) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('winners_watchlist')
      .select('*')
      .eq('account_id', selectedAccount)
      .order('rank', { ascending: true })
      .limit(50);

    if (!error && data) setWinners(data as Winner[]);
    setIsLoading(false);
  }, [selectedAccount]);

  useEffect(() => { load(); }, [load]);

  const refreshWatchlist = async () => {
    if (!selectedAccount) return;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-winners-watchlist', {
        body: { account_id: selectedAccount, top_n: 20 },
      });
      if (error) throw error;
      toast.success(`Watchlist updated — ${data.upserted} winners from ${data.total_groups} groups`);
      await load();
    } catch (err) {
      toast.error('Failed to refresh watchlist');
    } finally {
      setIsRefreshing(false);
    }
  };

  const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString();
  const selectedName = accounts.find(a => a.id === selectedAccount)?.display_name || '';

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Trophy className="h-6 w-6 text-amber-500" />
              Proven Winners
            </h1>
            <p className="text-muted-foreground mt-1">
              Top profitable models from uploaded sales logs — scrapers hunt these automatically
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select dealer" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={refreshWatchlist} disabled={isRefreshing || !selectedAccount}>
              {isRefreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Update from Sales
            </Button>
          </div>
        </div>

        {selectedName && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2 text-sm text-amber-400">
            Viewing winners for: <strong>{selectedName}</strong>
          </div>
        )}

        {!selectedAccount ? (
          <div className="text-center py-12 text-muted-foreground">Select a dealer account above to view their proven winners.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="text-right">Total Profit</TableHead>
                  <TableHead className="text-right">Avg Profit</TableHead>
                  <TableHead className="text-right">Times Sold</TableHead>
                  <TableHead className="text-right">Last Sale Price</TableHead>
                  <TableHead>Year Band</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {winners.map(w => (
                  <TableRow key={w.id} className={w.rank <= 3 ? 'bg-amber-500/5' : ''}>
                    <TableCell>
                      <Badge variant={w.rank <= 3 ? 'default' : 'outline'} className={w.rank <= 3 ? 'bg-amber-500 text-white' : ''}>
                        {w.rank}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{w.make} {w.model}</p>
                      {w.variant && <p className="text-xs text-muted-foreground">{w.variant}</p>}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-green-500">
                      {fmtMoney(w.total_profit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtMoney(w.avg_profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.times_sold}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtMoney(w.last_sale_price)}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {w.year_min && w.year_max ? `${w.year_min}–${w.year_max}` : '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && winners.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      No winners yet. Upload a sales log and click "Update from Sales".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
