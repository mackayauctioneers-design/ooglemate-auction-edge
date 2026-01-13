import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Search, Clock, CheckCircle, Radar } from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';

interface PreflightItem {
  id: string;
  type: 'trap' | 'auction';
  name: string;
  slug: string;
  preflight_status: string | null;
  preflight_reason: string | null;
  preflight_checked_at: string | null;
  enabled: boolean;
}

export default function PreflightQueuePage() {
  const [items, setItems] = useState<PreflightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Preflight Queue | Operator';
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [trapsRes, auctionsRes] = await Promise.all([
        supabase
          .from('dealer_traps')
          .select('id, dealer_name, trap_slug, preflight_status, preflight_reason, preflight_checked_at, enabled')
          .order('preflight_checked_at', { ascending: false, nullsFirst: true })
          .limit(100),
        supabase
          .from('auction_sources')
          .select('id, display_name, source_key, preflight_status, preflight_reason, preflight_checked_at, enabled')
          .order('preflight_checked_at', { ascending: false, nullsFirst: true })
          .limit(50)
      ]);

      if (trapsRes.error) throw trapsRes.error;
      if (auctionsRes.error) throw auctionsRes.error;

      const trapItems: PreflightItem[] = (trapsRes.data || []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        type: 'trap' as const,
        name: t.dealer_name as string,
        slug: t.trap_slug as string,
        preflight_status: t.preflight_status as string | null,
        preflight_reason: t.preflight_reason as string | null,
        preflight_checked_at: t.preflight_checked_at as string | null,
        enabled: t.enabled as boolean
      }));

      const auctionItems: PreflightItem[] = (auctionsRes.data || []).map((a: Record<string, unknown>) => ({
        id: a.id as string,
        type: 'auction' as const,
        name: a.display_name as string,
        slug: a.source_key as string,
        preflight_status: a.preflight_status as string | null,
        preflight_reason: a.preflight_reason as string | null,
        preflight_checked_at: a.preflight_checked_at as string | null,
        enabled: a.enabled as boolean
      }));

      setItems([...trapItems, ...auctionItems]);
    } catch (err) {
      console.error('Failed to fetch preflight data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.slug.toLowerCase().includes(search.toLowerCase())
  );

  const pending = items.filter((i) => i.preflight_status === 'pending' || !i.preflight_status).length;
  const passed = items.filter((i) => i.preflight_status === 'pass').length;
  const blocked = items.filter((i) => ['blocked', 'fail', 'timeout'].includes(i.preflight_status || '')).length;

  const statusBadge = (status: string | null) => {
    switch (status) {
      case 'pass': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Pass</Badge>;
      case 'blocked': return <Badge variant="destructive">Blocked</Badge>;
      case 'fail': return <Badge variant="destructive">Failed</Badge>;
      case 'timeout': return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">Timeout</Badge>;
      case 'pending':
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Preflight Queue</h1>
            <p className="text-muted-foreground">Preflight check status for traps and auctions</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{items.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" /> Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" /> Passed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-500">{passed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Radar className="h-4 w-4 text-red-500" /> Blocked/Failed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-500">{blocked}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-4">Name</th>
                    <th className="text-left py-2 pr-4">Type</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Checked</th>
                    <th className="text-left py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={`${item.type}-${item.id}`} className="border-b last:border-b-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.slug}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline">{item.type}</Badge>
                      </td>
                      <td className="py-3 pr-4">{statusBadge(item.preflight_status)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {item.preflight_checked_at
                          ? formatDistanceToNow(parseISO(item.preflight_checked_at), { addSuffix: true })
                          : 'Never'}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground max-w-xs truncate">
                        {item.preflight_reason || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">No items found</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
