import { useState, useEffect, useCallback } from 'react';
import { Play, RefreshCw, FileText, Loader2, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

type RunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL_FAIL' | 'FAIL';
type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAIL' | 'SKIPPED';

interface PipelineRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  triggered_by: string | null;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  error_summary: string | null;
}

interface PipelineStep {
  id: string;
  run_id: string;
  step_name: string;
  step_order: number;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  error_sample: string | null;
}

const STATUS_CONFIG: Record<RunStatus | StepStatus, { icon: typeof CheckCircle; className: string; label: string }> = {
  RUNNING: { icon: Loader2, className: 'text-blue-500 animate-spin', label: 'Running' },
  SUCCESS: { icon: CheckCircle, className: 'text-green-500', label: 'Success' },
  PARTIAL_FAIL: { icon: AlertTriangle, className: 'text-amber-500', label: 'Partial Fail' },
  FAIL: { icon: XCircle, className: 'text-destructive', label: 'Failed' },
  PENDING: { icon: Clock, className: 'text-muted-foreground', label: 'Pending' },
  SKIPPED: { icon: Clock, className: 'text-muted-foreground', label: 'Skipped' },
};

const STEP_LABELS: Record<string, string> = {
  trap_health: 'Trap Health Alerts',
  pickles_ingestion: 'Pickles Ingestion',
  valuations_ingestion: 'Valuations/Fingerprints',
  f3_ingestion: 'F3 Auction Crawl',
  postprocess_rules: 'Post-Process Rules',
  presence_tracking: 'Presence Tracking',
  slack_summary: 'Slack Summary',
};

export function DailyPipelinePanel() {
  const [lastRun, setLastRun] = useState<PipelineRun | null>(null);
  const [currentSteps, setCurrentSteps] = useState<PipelineStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [allRuns, setAllRuns] = useState<PipelineRun[]>([]);
  const [selectedRunSteps, setSelectedRunSteps] = useState<PipelineStep[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const fetchLastRun = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch last run:', error);
      return;
    }

    if (data) {
      setLastRun(data as PipelineRun);
      
      // If running, fetch steps
      if (data.status === 'RUNNING') {
        setIsPolling(true);
        const { data: steps } = await supabase
          .from('pipeline_steps')
          .select('*')
          .eq('run_id', data.id)
          .order('step_order', { ascending: true });
        
        if (steps) {
          setCurrentSteps(steps as PipelineStep[]);
        }
      } else {
        setIsPolling(false);
      }
    }
  }, []);

  const fetchAllRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to fetch runs:', error);
      return;
    }

    setAllRuns((data ?? []) as PipelineRun[]);
  }, []);

  const fetchStepsForRun = useCallback(async (runId: string) => {
    const { data, error } = await supabase
      .from('pipeline_steps')
      .select('*')
      .eq('run_id', runId)
      .order('step_order', { ascending: true });

    if (error) {
      console.error('Failed to fetch steps:', error);
      return;
    }

    setSelectedRunSteps((data ?? []) as PipelineStep[]);
    setSelectedRunId(runId);
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLastRun();
  }, [fetchLastRun]);

  // Polling while running
  useEffect(() => {
    if (!isPolling || !lastRun) return;

    const interval = setInterval(async () => {
      // Refetch run status
      const { data: runData } = await supabase
        .from('pipeline_runs')
        .select('*')
        .eq('id', lastRun.id)
        .single();

      if (runData) {
        setLastRun(runData as PipelineRun);
        
        if (runData.status !== 'RUNNING') {
          setIsPolling(false);
          setIsRunning(false);
          toast.success(`Pipeline ${runData.status === 'SUCCESS' ? 'completed successfully' : 'finished with issues'}`);
        }
      }

      // Refetch steps
      const { data: stepsData } = await supabase
        .from('pipeline_steps')
        .select('*')
        .eq('run_id', lastRun.id)
        .order('step_order', { ascending: true });

      if (stepsData) {
        setCurrentSteps(stepsData as PipelineStep[]);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPolling, lastRun]);

  const handleRunPipeline = async (retryFailed = false) => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('run-daily-pipeline', {
        body: {
          triggered_by: 'admin_ui',
          retry_failed_only: retryFailed,
          previous_run_id: retryFailed && lastRun ? lastRun.id : undefined,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.code === 'PIPELINE_LOCKED') {
        toast.error('Pipeline is already running');
        setIsRunning(false);
        return;
      }

      toast.success('Pipeline started');
      setIsPolling(true);
      
      // Fetch the new run immediately
      setTimeout(fetchLastRun, 500);
    } catch (error) {
      console.error('Failed to start pipeline:', error);
      toast.error('Failed to start pipeline: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsRunning(false);
    }
  };

  const handleOpenLogs = () => {
    fetchAllRuns();
    setShowLogsModal(true);
  };

  const StatusIcon = ({ status }: { status: RunStatus | StepStatus }) => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    return <Icon className={`h-4 w-4 ${config.className}`} />;
  };

  const StatusBadge = ({ status }: { status: RunStatus | StepStatus }) => {
    const config = STATUS_CONFIG[status];
    const variant = status === 'SUCCESS' ? 'default' : 
                   status === 'FAIL' ? 'destructive' : 
                   status === 'PARTIAL_FAIL' ? 'secondary' : 'outline';
    return (
      <Badge variant={variant} className="gap-1">
        <StatusIcon status={status} />
        {config.label}
      </Badge>
    );
  };

  const showRetryButton = lastRun && (lastRun.status === 'PARTIAL_FAIL' || lastRun.status === 'FAIL');

  return (
    <Card className="border-primary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Play className="h-5 w-5 text-primary" />
          Daily Pipeline
        </CardTitle>
        <CardDescription>
          Run all ingestion and processing steps in sequence
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last Run Status */}
        {lastRun && (
          <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Run</span>
              <StatusBadge status={lastRun.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })}
              {lastRun.triggered_by && ` • ${lastRun.triggered_by}`}
            </div>
            {lastRun.status !== 'RUNNING' && (
              <div className="text-xs">
                Steps: {lastRun.completed_steps}/{lastRun.total_steps} completed
                {lastRun.failed_steps > 0 && `, ${lastRun.failed_steps} failed`}
              </div>
            )}
          </div>
        )}

        {/* Live Step Progress */}
        {isPolling && currentSteps.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Progress</div>
            <div className="space-y-1">
              {currentSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-2 text-xs">
                  <StatusIcon status={step.status} />
                  <span className={step.status === 'RUNNING' ? 'font-medium' : ''}>
                    {STEP_LABELS[step.step_name] || step.step_name}
                  </span>
                  {step.status === 'SUCCESS' && step.records_processed > 0 && (
                    <span className="text-muted-foreground ml-auto">
                      {step.records_processed} processed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={() => handleRunPipeline(false)}
            disabled={isRunning || isPolling}
            className="gap-2"
          >
            {isRunning || isPolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Daily Pipeline
          </Button>
          
          {showRetryButton && (
            <Button 
              onClick={() => handleRunPipeline(true)}
              disabled={isRunning || isPolling}
              variant="secondary"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Failed
            </Button>
          )}
          
          <Dialog open={showLogsModal} onOpenChange={setShowLogsModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" onClick={handleOpenLogs}>
                <FileText className="h-4 w-4" />
                View Logs
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Pipeline Run History</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 h-[60vh]">
                {/* Runs List */}
                <ScrollArea className="border rounded-lg p-2">
                  <div className="space-y-1">
                    {allRuns.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => fetchStepsForRun(run.id)}
                        className={`w-full text-left p-2 rounded-md text-sm hover:bg-muted transition-colors ${
                          selectedRunId === run.id ? 'bg-muted' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <StatusBadge status={run.status} />
                          <span className="text-xs text-muted-foreground">
                            {run.total_steps} steps
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>

                {/* Steps Detail */}
                <ScrollArea className="border rounded-lg p-2">
                  {selectedRunSteps.length > 0 ? (
                    <div className="space-y-2">
                      {selectedRunSteps.map((step) => (
                        <div key={step.id} className="p-2 rounded-md bg-muted/50">
                          <div className="flex items-center gap-2">
                            <StatusIcon status={step.status} />
                            <span className="font-medium text-sm">
                              {STEP_LABELS[step.step_name] || step.step_name}
                            </span>
                          </div>
                          {step.status === 'SUCCESS' && (
                            <div className="text-xs text-muted-foreground mt-1 ml-6">
                              {step.records_processed > 0 && `${step.records_processed} processed`}
                              {step.records_created > 0 && ` • ${step.records_created} created`}
                              {step.records_updated > 0 && ` • ${step.records_updated} updated`}
                            </div>
                          )}
                          {step.error_sample && (
                            <div className="text-xs text-destructive mt-1 ml-6 break-all">
                              {step.error_sample}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      Select a run to view steps
                    </div>
                  )}
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
