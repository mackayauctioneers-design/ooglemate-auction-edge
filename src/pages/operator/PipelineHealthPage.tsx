import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { LayoutNestingProvider } from '@/components/layout/LayoutContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity } from 'lucide-react';
import OperatorIngestionHealthPage from '@/pages/operator/OperatorIngestionHealthPage';
import IngestionAuditPage from '@/pages/operator/IngestionAuditPage';
import CronAuditPage from '@/pages/operator/CronAuditPage';
import JobQueuePage from '@/pages/operator/JobQueuePage';
import AuctionEnrichmentQueuePage from '@/pages/operator/AuctionEnrichmentQueuePage';
import CrossSafeMonitorPage from '@/pages/operator/CrossSafeMonitorPage';

export default function PipelineHealthPage() {
  useEffect(() => {
    document.title = 'Pipeline Health | Operator';
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pipeline Health</h1>
            <p className="text-sm text-muted-foreground">Ingestion health, audit logs, cron jobs, and queue monitoring.</p>
          </div>
        </div>

        <Tabs defaultValue="health" className="w-full">
          <TabsList className="flex-wrap">
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
            <TabsTrigger value="cron">Cron</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="auction-queue">Auction Queue</TabsTrigger>
            <TabsTrigger value="crosssafe">CrossSafe</TabsTrigger>
          </TabsList>

          <LayoutNestingProvider value={true}>
            <TabsContent value="health">
              <OperatorIngestionHealthPage />
            </TabsContent>
            <TabsContent value="audit">
              <IngestionAuditPage />
            </TabsContent>
            <TabsContent value="cron">
              <CronAuditPage />
            </TabsContent>
            <TabsContent value="jobs">
              <JobQueuePage />
            </TabsContent>
            <TabsContent value="auction-queue">
              <AuctionEnrichmentQueuePage />
            </TabsContent>
            <TabsContent value="crosssafe">
              <CrossSafeMonitorPage />
            </TabsContent>
          </LayoutNestingProvider>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
