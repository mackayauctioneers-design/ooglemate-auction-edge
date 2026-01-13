import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface CronLog {
  id: string;
  cron_name: string;
  run_date: string;
  run_at: string;
  success: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
}

export default function CronAuditPage() {
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Cron Audit Log | Operator';
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cron_audit_log')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs((data as CronLog[]) || []);
    } catch (err) {
      console.error('Failed to fetch cron logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const cronStats = logs.reduce((acc, log) => {
    if (!acc[log.cron_name]) {
      acc[log.cron_name] = { total: 0, success: 0, failed: 0 };
    }
    acc[log.cron_name].total++;
    if (log.success) acc[log.cron_name].success++;
    else acc[log.cron_name].failed++;
    return acc;
  }, {} as Record<string, { total: number; success: number; failed: number }>);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cron Audit Log</h1>
            <p className="text-muted-foreground">Scheduled task execution history</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(cronStats).slice(0, 8).map(([name, stats]) => (
            <Card key={name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium truncate">{name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">{stats.total}</span>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                      {stats.success}
                    </Badge>
                    {stats.failed > 0 && (
                      <Badge variant="destructive">{stats.failed}</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-4">Cron</th>
                    <th className="text-left py-2 pr-4">Run Date</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2">Result / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b last:border-b-0">
                      <td className="py-3 pr-4 font-medium">{log.cron_name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {format(parseISO(log.run_at), 'dd MMM yyyy HH:mm')}
                      </td>
                      <td className="py-3 pr-4">
                        {log.success ? (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle className="h-4 w-4" /> OK
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-500">
                            <XCircle className="h-4 w-4" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-muted-foreground text-xs max-w-xs truncate">
                        {log.error || (log.result ? JSON.stringify(log.result) : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">No cron runs found</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
