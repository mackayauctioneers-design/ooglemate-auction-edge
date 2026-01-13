import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Search, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface Trap {
  id: string;
  trap_slug: string;
  dealer_name: string;
  region_id: string;
  enabled: boolean;
  validation_status: string;
  parser_mode: string;
  parser_confidence: string | null;
  last_crawl_at: string | null;
  last_vehicle_count: number | null;
  consecutive_failures: number;
}

export default function TrapsRegistryPage() {
  const [traps, setTraps] = useState<Trap[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Traps Registry | Operator';
  }, []);

  const fetchTraps = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_traps')
        .select('id, trap_slug, dealer_name, region_id, enabled, validation_status, parser_mode, parser_confidence, last_crawl_at, last_vehicle_count, consecutive_failures')
        .order('dealer_name', { ascending: true })
        .limit(200);

      if (error) throw error;
      setTraps((data as Trap[]) || []);
    } catch (err) {
      console.error('Failed to fetch traps:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTraps();
  }, []);

  const filtered = traps.filter((t) =>
    t.dealer_name.toLowerCase().includes(search.toLowerCase()) ||
    t.trap_slug.toLowerCase().includes(search.toLowerCase()) ||
    t.region_id.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = traps.filter((t) => t.enabled).length;
  const validatedCount = traps.filter((t) => t.validation_status === 'validated').length;
  const failingCount = traps.filter((t) => t.consecutive_failures > 0).length;

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Traps Registry</h1>
            <p className="text-muted-foreground">Manage dealer trap configurations</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchTraps} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Traps</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{traps.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" /> Enabled
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-500">{enabledCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Validated</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{validatedCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Failing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-500">{failingCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search traps..."
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
                    <th className="text-left py-2 pr-4">Dealer</th>
                    <th className="text-left py-2 pr-4">Region</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Parser</th>
                    <th className="text-left py-2 pr-4">Last Crawl</th>
                    <th className="text-left py-2">Vehicles</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((trap) => (
                    <tr key={trap.id} className="border-b last:border-b-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{trap.dealer_name}</div>
                        <div className="text-xs text-muted-foreground">{trap.trap_slug}</div>
                      </td>
                      <td className="py-3 pr-4">{trap.region_id.replace(/_/g, ' ')}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          {trap.enabled ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Enabled</Badge>
                          ) : (
                            <Badge variant="secondary">Disabled</Badge>
                          )}
                          {trap.consecutive_failures > 0 && (
                            <Badge variant="destructive">{trap.consecutive_failures} fails</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div>{trap.parser_mode}</div>
                        {trap.parser_confidence && (
                          <div className="text-xs text-muted-foreground">{trap.parser_confidence}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {trap.last_crawl_at ? format(parseISO(trap.last_crawl_at), 'dd MMM HH:mm') : '—'}
                      </td>
                      <td className="py-3 font-mono">{trap.last_vehicle_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">No traps found</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
