import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { LayoutNestingProvider } from '@/components/layout/LayoutContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bell } from 'lucide-react';
import HuntAlertsPage from '@/pages/HuntAlertsPage';
import UnifiedOpportunitiesPage from '@/pages/UnifiedOpportunitiesPage';
import MatchesInboxPage from '@/pages/MatchesInboxPage';
import RetailSignalsPage from '@/pages/RetailSignalsPage';

export default function AlertsMatchesPage() {
  useEffect(() => {
    document.title = 'Alerts & Matches | Operator';
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alerts & Matches</h1>
            <p className="text-sm text-muted-foreground">Hunt alerts, opportunities, matches, and retail signals in one place.</p>
          </div>
        </div>

        <Tabs defaultValue="hunt-alerts" className="w-full">
          <TabsList>
            <TabsTrigger value="hunt-alerts">Hunt Alerts</TabsTrigger>
            <TabsTrigger value="opportunities">Live Opportunities</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="retail-signals">Retail Signals</TabsTrigger>
          </TabsList>

          <LayoutNestingProvider value={true}>
            <TabsContent value="hunt-alerts">
              <HuntAlertsPage />
            </TabsContent>
            <TabsContent value="opportunities">
              <UnifiedOpportunitiesPage />
            </TabsContent>
            <TabsContent value="matches">
              <MatchesInboxPage />
            </TabsContent>
            <TabsContent value="retail-signals">
              <RetailSignalsPage />
            </TabsContent>
          </LayoutNestingProvider>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
