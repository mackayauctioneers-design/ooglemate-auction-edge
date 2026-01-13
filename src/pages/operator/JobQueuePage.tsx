import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Clock, Play, CheckCircle, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface Job {
  id: string;
  trap_slug: string;
  run_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export default function JobQueuePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Job Queue | Operator';
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('trap_crawl_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setJobs((data as Job[]) || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  const statusCounts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'processing': return <Play className="h-4 w-4 text-blue-500" />;
      case 'completed': return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return null;
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">Pending</Badge>;
      case 'processing': return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">Processing</Badge>;
      case 'completed': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Completed</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Job Queue</h1>
            <p className="text-muted-foreground">Background crawl job management</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchJobs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['pending', 'processing', 'completed', 'failed'].map((status) => (
            <Card key={status}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {statusIcon(status)}
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{statusCounts[status] || 0}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Jobs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-4">Trap</th>
                    <th className="text-left py-2 pr-4">Type</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Attempts</th>
                    <th className="text-left py-2 pr-4">Created</th>
                    <th className="text-left py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b last:border-b-0">
                      <td className="py-3 pr-4 font-medium">{job.trap_slug}</td>
                      <td className="py-3 pr-4">{job.run_type}</td>
                      <td className="py-3 pr-4">{statusBadge(job.status)}</td>
                      <td className="py-3 pr-4">{job.attempts}/{job.max_attempts}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {format(parseISO(job.created_at), 'dd MMM HH:mm')}
                      </td>
                      <td className="py-3 text-xs text-red-500 max-w-xs truncate">
                        {job.error || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {jobs.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">No jobs found</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
