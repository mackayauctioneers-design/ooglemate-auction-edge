import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BobSiteContextProvider } from "@/contexts/BobSiteContext";
import { OperatorGuard } from "@/components/guards/OperatorGuard";
import { RequireAdmin } from "@/components/guards/RequireAdmin";
import { RequireAuth } from "@/components/guards/RequireAuth";
// Dealer pages
import OpportunitiesPage from "./pages/OpportunitiesPage";
import TodayPage from "./pages/TodayPage";
import UpcomingAuctionsPage from "./pages/UpcomingAuctionsPage";
import SearchLotsPage from "./pages/SearchLotsPage";
import TrapInventoryPage from "./pages/TrapInventoryPage";
import MatchesPage from "./pages/MatchesPage";
import ValuationPage from "./pages/ValuationPage";
import HelpPage from "./pages/HelpPage";
import ValoPage from "./pages/ValoPage";
import DealerDashboardPage from "./pages/DealerDashboardPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import VAIntakePage from "./pages/VAIntakePage";
import LogSalePage from "./pages/LogSalePage";
import VATasksPage from "./pages/VATasksPage";
import HuntsPage from "./pages/HuntsPage";
import HuntDetailPage from "./pages/HuntDetailPage";
import HuntAlertsPage from "./pages/HuntAlertsPage";
import UnifiedAlertsPage from "./pages/UnifiedAlertsPage";

// Operator pages
import OperatorDashboardPage from "./pages/operator/OperatorDashboardPage";
import OperatorIngestionHealthPage from "./pages/operator/OperatorIngestionHealthPage";
import CronAuditPage from "./pages/operator/CronAuditPage";
import TrapHealthAlertsPage from "./pages/operator/TrapHealthAlertsPage";
import JobQueuePage from "./pages/operator/JobQueuePage";
import TrapsRegistryPage from "./pages/operator/TrapsRegistryPage";
import PreflightQueuePage from "./pages/operator/PreflightQueuePage";
import FingerprintsExplorerPage from "./pages/operator/FingerprintsExplorerPage";
import FeedingModeReportPage from "./pages/operator/FeedingModeReportPage";
import BenchmarkGapPanel from "./pages/operator/BenchmarkGapPanel";
import BenchmarkWatchlistPage from "./pages/operator/BenchmarkWatchlistPage";
import AddAuctionSourcePage from "./pages/operator/AddAuctionSourcePage";
import OperatorDealerSpecsPage from "./pages/operator/DealerSpecsPage";
import FranchisePortalFeedsPage from "./pages/operator/FranchisePortalFeedsPage";
import VASalesDataPage from "./pages/operator/VASalesDataPage";
import TriggerQAPage from "./pages/operator/TriggerQAPage";
import DealerUrlIntakePage from "./pages/operator/DealerUrlIntakePage";
import TargetsPoolPage from "./pages/operator/TargetsPoolPage";

// Carbitrage pages (Josh workflow)
import JoshInboxPage from "./pages/carbitrage/JoshInboxPage";
import WatchlistPage from "./pages/carbitrage/WatchlistPage";
import DaveInboxPage from "./pages/carbitrage/DaveInboxPage";
import DealerUrlBankPage from "./pages/carbitrage/DealerUrlBankPage";
import GrokMissionPage from "./pages/carbitrage/GrokMissionPage";
import SalesUploadPage from "./pages/carbitrage/SalesUploadPage";
import SalesInsightsPage from "./pages/SalesInsightsPage";
import JoshDailyTargetsPage from "./pages/JoshDailyTargetsPage";
import BuyAgainTargetsPage from "./pages/BuyAgainTargetsPage";
import MatchesInboxPage from "./pages/MatchesInboxPage";
import DealsPage from "./pages/DealsPage";
import DealDetailPage from "./pages/DealDetailPage";
import ScanGuidePage from "./pages/ScanGuidePage";
import ReplicationEnginePage from "./pages/ReplicationEnginePage";
import LiveAlertsPage from "./pages/LiveAlertsPage";
import UnifiedOpportunitiesPage from "./pages/UnifiedOpportunitiesPage";
import RetailSignalsPage from "./pages/RetailSignalsPage";
import WinnersWatchlistPage from "./pages/WinnersWatchlistPage";

// Dealer spec pages
import DealerSpecsListPage from "./pages/dealer/DealerSpecsPage";
import DealerSpecFormPage from "./pages/dealer/DealerSpecFormPage";

const queryClient = new QueryClient();

// ============================================================================
// ROUTING: DEALER MODE vs OPERATOR MODE
// ============================================================================
// Dealer Mode: Primary UI for dealers - Search Lots, Upcoming Auctions, etc.
// Operator Mode: Backend controls for admin/internal users only.
// 
// - Dealer routes: /, /upcoming-auctions, /search-lots, /matches, /valuation, etc.
// - Operator routes: /operator/* (protected by OperatorGuard)
// - Admin tools: /admin-tools/* (protected by RequireAdmin)
// ============================================================================

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <BobSiteContextProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Routes>
              {/* === DEALER ROUTES: All authenticated users === */}
              <Route path="/" element={<RequireAuth><TodayPage /></RequireAuth>} />
              <Route path="/today" element={<RequireAuth><TodayPage /></RequireAuth>} />
              <Route path="/opportunities-legacy" element={<RequireAuth><OpportunitiesPage /></RequireAuth>} />
              <Route path="/opportunities" element={<RequireAuth><UnifiedOpportunitiesPage /></RequireAuth>} />
              <Route path="/upcoming-auctions" element={<RequireAuth><UpcomingAuctionsPage /></RequireAuth>} />
              <Route path="/search-lots" element={<RequireAuth><SearchLotsPage /></RequireAuth>} />
              <Route path="/trap-inventory" element={<RequireAuth><TrapInventoryPage /></RequireAuth>} />
              <Route path="/matches" element={<RequireAuth><MatchesPage /></RequireAuth>} />
              <Route path="/valuation" element={<RequireAuth><ValuationPage /></RequireAuth>} />
              <Route path="/valo" element={<RequireAuth><ValoPage /></RequireAuth>} />
              <Route path="/dealer-dashboard" element={<RequireAuth><DealerDashboardPage /></RequireAuth>} />
              <Route path="/log-sale" element={<RequireAuth><LogSalePage /></RequireAuth>} />
              <Route path="/help" element={<RequireAuth><HelpPage /></RequireAuth>} />
              <Route path="/auth" element={<AuthPage />} />
              
              {/* Hunts */}
              <Route path="/hunts" element={<RequireAuth><HuntsPage /></RequireAuth>} />
              <Route path="/hunts/:huntId" element={<RequireAuth><HuntDetailPage /></RequireAuth>} />
              <Route path="/hunt-alerts" element={<RequireAuth><HuntAlertsPage /></RequireAuth>} />
              <Route path="/alerts" element={<RequireAuth><UnifiedAlertsPage /></RequireAuth>} />
              <Route path="/live-alerts" element={<RequireAuth><LiveAlertsPage /></RequireAuth>} />
              
              {/* Carbitrage - Josh Workflow */}
              <Route path="/josh" element={<RequireAuth><JoshInboxPage /></RequireAuth>} />
              <Route path="/watchlist" element={<RequireAuth><WatchlistPage /></RequireAuth>} />
              <Route path="/dave" element={<RequireAuth><DaveInboxPage /></RequireAuth>} />
              <Route path="/dealer-urls" element={<RequireAuth><DealerUrlBankPage /></RequireAuth>} />
              <Route path="/grok-missions" element={<RequireAuth><GrokMissionPage /></RequireAuth>} />
              <Route path="/sales-upload" element={<RequireAuth><SalesUploadPage /></RequireAuth>} />
              <Route path="/sales-insights" element={<RequireAuth><SalesInsightsPage /></RequireAuth>} />
              <Route path="/scan-guide" element={<RequireAuth><ScanGuidePage /></RequireAuth>} />
              <Route path="/targets" element={<RequireAuth><JoshDailyTargetsPage /></RequireAuth>} />
              <Route path="/buy-again" element={<RequireAuth><BuyAgainTargetsPage /></RequireAuth>} />
              <Route path="/matches-inbox" element={<RequireAuth><MatchesInboxPage /></RequireAuth>} />
              <Route path="/deals" element={<RequireAuth><DealsPage /></RequireAuth>} />
              <Route path="/deals/:dealId" element={<RequireAuth><DealDetailPage /></RequireAuth>} />
              <Route path="/replication" element={<RequireAuth><ReplicationEnginePage /></RequireAuth>} />
              <Route path="/retail-signals" element={<RequireAuth><RetailSignalsPage /></RequireAuth>} />
              <Route path="/winners" element={<RequireAuth><WinnersWatchlistPage /></RequireAuth>} />
              {/* Dealer Specs */}
              <Route path="/dealer/specs" element={<RequireAuth><DealerSpecsListPage /></RequireAuth>} />
              <Route path="/dealer/specs/new" element={<RequireAuth><DealerSpecFormPage /></RequireAuth>} />
              <Route path="/dealer/specs/:id" element={<RequireAuth><DealerSpecFormPage /></RequireAuth>} />

              {/* === OPERATOR ROUTES: Admin/Internal only === */}
              {/* Dashboard */}
              <Route path="/operator" element={
                <OperatorGuard><OperatorDashboardPage /></OperatorGuard>
              } />

              {/* Monitoring */}
              <Route path="/operator/ingestion-health" element={
                <OperatorGuard><OperatorIngestionHealthPage /></OperatorGuard>
              } />
              <Route path="/operator/cron-audit" element={
                <OperatorGuard><CronAuditPage /></OperatorGuard>
              } />
              <Route path="/operator/trap-health" element={
                <OperatorGuard><TrapHealthAlertsPage /></OperatorGuard>
              } />
              <Route path="/operator/job-queue" element={
                <OperatorGuard><JobQueuePage /></OperatorGuard>
              } />

              {/* Data Ops */}
              <Route path="/operator/traps" element={
                <OperatorGuard><TrapsRegistryPage /></OperatorGuard>
              } />
              <Route path="/operator/preflight" element={
                <OperatorGuard><PreflightQueuePage /></OperatorGuard>
              } />
              <Route path="/operator/auctions/add" element={
                <OperatorGuard><AddAuctionSourcePage /></OperatorGuard>
              } />
              <Route path="/operator/franchise-feeds" element={
                <OperatorGuard><FranchisePortalFeedsPage /></OperatorGuard>
              } />

              {/* Analytics */}
              <Route path="/operator/feeding-mode" element={
                <OperatorGuard><FeedingModeReportPage /></OperatorGuard>
              } />
              <Route path="/operator/fingerprints" element={
                <RequireAdmin><FingerprintsExplorerPage /></RequireAdmin>
              } />
              <Route path="/operator/benchmark-gaps" element={
                <RequireAdmin><BenchmarkGapPanel /></RequireAdmin>
              } />
              <Route path="/operator/benchmark-watchlist" element={
                <RequireAdmin><BenchmarkWatchlistPage /></RequireAdmin>
              } />
              <Route path="/operator/dealer-specs" element={
                <RequireAdmin><OperatorDealerSpecsPage /></RequireAdmin>
              } />
              <Route path="/operator/va-sales" element={
                <OperatorGuard><VASalesDataPage /></OperatorGuard>
              } />
              <Route path="/operator/trigger-qa" element={
                <OperatorGuard><TriggerQAPage /></OperatorGuard>
              } />
              <Route path="/operator/dealer-urls" element={
                <OperatorGuard><DealerUrlIntakePage /></OperatorGuard>
              } />
              <Route path="/operator/targets" element={
                <OperatorGuard><TargetsPoolPage /></OperatorGuard>
              } />
              {/* === ADMIN TOOLS: Protected by RequireAdmin === */}
              <Route path="/admin-tools" element={
                <RequireAdmin><NotFound /></RequireAdmin>
              } />
              <Route path="/admin-tools/va-intake" element={
                <RequireAdmin><VAIntakePage /></RequireAdmin>
              } />
              {/* Alias for fingerprints explorer */}
              <Route path="/admin-tools/fingerprints" element={
                <RequireAdmin><FingerprintsExplorerPage /></RequireAdmin>
              } />

              {/* === VA ROUTES: Authenticated users === */}
              <Route
                path="/va/tasks"
                element={
                  <RequireAuth>
                    <VATasksPage />
                  </RequireAuth>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </BobSiteContextProvider>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
