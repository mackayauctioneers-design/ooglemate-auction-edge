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
              <Route path="/" element={<OpportunitiesPage />} />
              <Route path="/upcoming-auctions" element={<UpcomingAuctionsPage />} />
              <Route path="/search-lots" element={<SearchLotsPage />} />
              <Route path="/trap-inventory" element={<TrapInventoryPage />} />
              <Route path="/matches" element={<MatchesPage />} />
              <Route path="/valuation" element={<ValuationPage />} />
              <Route path="/valo" element={<ValoPage />} />
              <Route path="/dealer-dashboard" element={<DealerDashboardPage />} />
              <Route path="/log-sale" element={<LogSalePage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/auth" element={<AuthPage />} />
              
              {/* Dealer Specs */}
              <Route path="/dealer/specs" element={<DealerSpecsListPage />} />
              <Route path="/dealer/specs/new" element={<DealerSpecFormPage />} />
              <Route path="/dealer/specs/:id" element={<DealerSpecFormPage />} />

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
