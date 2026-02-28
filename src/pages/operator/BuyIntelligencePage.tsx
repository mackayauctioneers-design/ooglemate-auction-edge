import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { LayoutNestingProvider } from '@/components/layout/LayoutContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp } from 'lucide-react';
import WinnersWatchlistPage from '@/pages/WinnersWatchlistPage';
import BuyAgainTargetsPage from '@/pages/BuyAgainTargetsPage';
import ReplicationEnginePage from '@/pages/ReplicationEnginePage';

export default function BuyIntelligencePage() {
  useEffect(() => {
    document.title = 'Buy Intelligence | Operator';
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Buy Intelligence</h1>
            <p className="text-sm text-muted-foreground">Winners watchlist, buy-again targets, and replication engine.</p>
          </div>
        </div>

        <Tabs defaultValue="winners" className="w-full">
          <TabsList>
            <TabsTrigger value="winners">Winners</TabsTrigger>
            <TabsTrigger value="buy-again">Buy Again</TabsTrigger>
            <TabsTrigger value="replication">Replication</TabsTrigger>
          </TabsList>

          <LayoutNestingProvider value={true}>
            <TabsContent value="winners">
              <WinnersWatchlistPage />
            </TabsContent>
            <TabsContent value="buy-again">
              <BuyAgainTargetsPage />
            </TabsContent>
            <TabsContent value="replication">
              <ReplicationEnginePage />
            </TabsContent>
          </LayoutNestingProvider>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
