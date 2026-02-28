import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { LayoutNestingProvider } from '@/components/layout/LayoutContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Database } from 'lucide-react';
import OperatorDealerUploadPage from '@/pages/operator/OperatorDealerUploadPage';
import ManualIntakePage from '@/pages/operator/ManualIntakePage';
import TrapsRegistryPage from '@/pages/operator/TrapsRegistryPage';
import PreflightQueuePage from '@/pages/operator/PreflightQueuePage';
import DealerUrlIntakePage from '@/pages/operator/DealerUrlIntakePage';
import VASalesDataPage from '@/pages/operator/VASalesDataPage';

export default function DataSourcesPage() {
  useEffect(() => {
    document.title = 'Data Sources | Operator';
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Data Sources</h1>
            <p className="text-sm text-muted-foreground">Dealer uploads, intake, traps, preflight, and VA data.</p>
          </div>
        </div>

        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="flex-wrap">
            <TabsTrigger value="upload">Dealer Upload</TabsTrigger>
            <TabsTrigger value="intake">Manual Intake</TabsTrigger>
            <TabsTrigger value="traps">Traps</TabsTrigger>
            <TabsTrigger value="preflight">Preflight</TabsTrigger>
            <TabsTrigger value="dealer-urls">Dealer URLs</TabsTrigger>
            <TabsTrigger value="va">VA Data</TabsTrigger>
          </TabsList>

          <LayoutNestingProvider value={true}>
            <TabsContent value="upload">
              <OperatorDealerUploadPage />
            </TabsContent>
            <TabsContent value="intake">
              <ManualIntakePage />
            </TabsContent>
            <TabsContent value="traps">
              <TrapsRegistryPage />
            </TabsContent>
            <TabsContent value="preflight">
              <PreflightQueuePage />
            </TabsContent>
            <TabsContent value="dealer-urls">
              <DealerUrlIntakePage />
            </TabsContent>
            <TabsContent value="va">
              <VASalesDataPage />
            </TabsContent>
          </LayoutNestingProvider>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
