import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BobSiteContextProvider } from "@/contexts/BobSiteContext";
import { OperatorGuard } from "@/components/guards/OperatorGuard";
import { RequireAdmin } from "@/components/guards/RequireAdmin";
import { RequireAuth } from "@/components/guards/RequireAuth";

// Dealer pages
import TradingDeskPage from "./pages/TradingDeskPage";
import DealsPage from "./pages/DealsPage";
import DealDetailPage from "./pages/DealDetailPage";
import SalesUploadPage from "./pages/carbitrage/SalesUploadPage";
import SalesInsightsPage from "./pages/SalesInsightsPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import ValoPage from "./pages/ValoPage";
import ScanGuidePage from "./pages/ScanGuidePage";

// Operator pages
import OperatorDashboardPage from "./pages/operator/OperatorDashboardPage";
import OperatorIngestionHealthPage from "./pages/operator/OperatorIngestionHealthPage";
import IngestionAuditPage from "./pages/operator/IngestionAuditPage";
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
import OperatorTradingDeskPage from "./pages/operator/TradingDeskPage";
import CrossSafeMonitorPage from "./pages/operator/CrossSafeMonitorPage";
import VAIntakePage from "./pages/VAIntakePage";
import VATasksPage from "./pages/VATasksPage";

// Carbitrage legacy pages kept for operator access
import JoshInboxPage from "./pages/carbitrage/JoshInboxPage";
import WatchlistPage from "./pages/carbitrage/WatchlistPage";
import DaveInboxPage from "./pages/carbitrage/DaveInboxPage";
import DealerUrlBankPage from "./pages/carbitrage/DealerUrlBankPage";
import GrokMissionPage from "./pages/carbitrage/GrokMissionPage";
import UnifiedAlertsPage from "./pages/UnifiedAlertsPage";
import SearchLotsPage from "./pages/SearchLotsPage";
import TrapInventoryPage from "./pages/TrapInventoryPage";
import UpcomingAuctionsPage from "./pages/UpcomingAuctionsPage";
import ValuationPage from "./pages/ValuationPage";
import HuntsPage from "./pages/HuntsPage";
import HuntDetailPage from "./pages/HuntDetailPage";

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
              {/* === DEALER ROUTES === */}
              <Route path="/" element={<RequireAuth><TradingDeskPage /></RequireAuth>} />
              <Route path="/trading-desk" element={<RequireAuth><TradingDeskPage /></RequireAuth>} />
              <Route path="/sales-upload" element={<RequireAuth><SalesUploadPage /></RequireAuth>} />
              <Route path="/sales-insights" element={<RequireAuth><SalesInsightsPage /></RequireAuth>} />
              <Route path="/deals" element={<RequireAuth><DealsPage /></RequireAuth>} />
              <Route path="/deals/:dealId" element={<RequireAuth><DealDetailPage /></RequireAuth>} />
              <Route path="/valo" element={<RequireAuth><ValoPage /></RequireAuth>} />
              <Route path="/scan-guide" element={<RequireAuth><ScanGuidePage /></RequireAuth>} />
              <Route path="/auth" element={<AuthPage />} />

              {/* === LEGACY REDIRECTS → Trading Desk === */}
              <Route path="/today" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/matches" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/matches-inbox" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/buy-again" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/opportunities" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/opportunities-legacy" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/live-alerts" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/replication" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/retail-signals" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/winners" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/intelligence" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/targets" element={<Navigate to="/trading-desk" replace />} />
              <Route path="/dealer-dashboard" element={<Navigate to="/trading-desk" replace />} />

              {/* === OPERATOR-ONLY ROUTES (kept for admin workflow) === */}
              <Route path="/josh" element={<OperatorGuard><JoshInboxPage /></OperatorGuard>} />
              <Route path="/watchlist" element={<OperatorGuard><WatchlistPage /></OperatorGuard>} />
              <Route path="/dave" element={<OperatorGuard><DaveInboxPage /></OperatorGuard>} />
              <Route path="/dealer-urls" element={<OperatorGuard><DealerUrlBankPage /></OperatorGuard>} />
              <Route path="/grok-missions" element={<OperatorGuard><GrokMissionPage /></OperatorGuard>} />
              <Route path="/alerts" element={<OperatorGuard><UnifiedAlertsPage /></OperatorGuard>} />
              <Route path="/hunts" element={<OperatorGuard><HuntsPage /></OperatorGuard>} />
              <Route path="/hunts/:huntId" element={<OperatorGuard><HuntDetailPage /></OperatorGuard>} />
              <Route path="/upcoming-auctions" element={<OperatorGuard><UpcomingAuctionsPage /></OperatorGuard>} />
              <Route path="/search-lots" element={<OperatorGuard><SearchLotsPage /></OperatorGuard>} />
              <Route path="/trap-inventory" element={<OperatorGuard><TrapInventoryPage /></OperatorGuard>} />
              <Route path="/valuation" element={<OperatorGuard><ValuationPage /></OperatorGuard>} />

              {/* === OPERATOR ROUTES: Admin/Internal only === */}
              <Route path="/operator" element={<OperatorGuard><OperatorDashboardPage /></OperatorGuard>} />
              <Route path="/operator/ingestion-health" element={<OperatorGuard><OperatorIngestionHealthPage /></OperatorGuard>} />
              <Route path="/operator/ingestion-audit" element={<OperatorGuard><IngestionAuditPage /></OperatorGuard>} />
              <Route path="/operator/cron-audit" element={<OperatorGuard><CronAuditPage /></OperatorGuard>} />
              <Route path="/operator/trap-health" element={<OperatorGuard><TrapHealthAlertsPage /></OperatorGuard>} />
              <Route path="/operator/job-queue" element={<OperatorGuard><JobQueuePage /></OperatorGuard>} />
              <Route path="/operator/traps" element={<OperatorGuard><TrapsRegistryPage /></OperatorGuard>} />
              <Route path="/operator/preflight" element={<OperatorGuard><PreflightQueuePage /></OperatorGuard>} />
              <Route path="/operator/auctions/add" element={<OperatorGuard><AddAuctionSourcePage /></OperatorGuard>} />
              <Route path="/operator/franchise-feeds" element={<OperatorGuard><FranchisePortalFeedsPage /></OperatorGuard>} />
              <Route path="/operator/feeding-mode" element={<OperatorGuard><FeedingModeReportPage /></OperatorGuard>} />
              <Route path="/operator/fingerprints" element={<RequireAdmin><FingerprintsExplorerPage /></RequireAdmin>} />
              <Route path="/operator/benchmark-gaps" element={<RequireAdmin><BenchmarkGapPanel /></RequireAdmin>} />
              <Route path="/operator/benchmark-watchlist" element={<RequireAdmin><BenchmarkWatchlistPage /></RequireAdmin>} />
              <Route path="/operator/dealer-specs" element={<RequireAdmin><OperatorDealerSpecsPage /></RequireAdmin>} />
              <Route path="/operator/va-sales" element={<OperatorGuard><VASalesDataPage /></OperatorGuard>} />
              <Route path="/operator/trigger-qa" element={<OperatorGuard><TriggerQAPage /></OperatorGuard>} />
              <Route path="/operator/dealer-urls" element={<OperatorGuard><DealerUrlIntakePage /></OperatorGuard>} />
              <Route path="/operator/targets" element={<OperatorGuard><TargetsPoolPage /></OperatorGuard>} />
              <Route path="/operator/trading-desk" element={<OperatorGuard><OperatorTradingDeskPage /></OperatorGuard>} />
              <Route path="/operator/crosssafe" element={<OperatorGuard><CrossSafeMonitorPage /></OperatorGuard>} />

              {/* Admin Tools */}
              <Route path="/admin-tools" element={<RequireAdmin><NotFound /></RequireAdmin>} />
              <Route path="/admin-tools/va-intake" element={<RequireAdmin><VAIntakePage /></RequireAdmin>} />
              <Route path="/admin-tools/fingerprints" element={<RequireAdmin><FingerprintsExplorerPage /></RequireAdmin>} />

              {/* VA */}
              <Route path="/va/tasks" element={<RequireAuth><VATasksPage /></RequireAuth>} />

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
