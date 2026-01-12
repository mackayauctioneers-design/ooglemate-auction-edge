import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { OperatorGuard } from "@/components/guards/OperatorGuard";
import { RequireAdmin } from "@/components/guards/RequireAdmin";

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

// Operator pages
import OperatorIngestionHealthPage from "./pages/operator/OperatorIngestionHealthPage";
import { OperatorPlaceholderPage } from "./pages/operator/OperatorPlaceholderPage";
import FingerprintsExplorerPage from "./pages/operator/FingerprintsExplorerPage";
import FeedingModeReportPage from "./pages/operator/FeedingModeReportPage";
import BenchmarkGapPanel from "./pages/operator/BenchmarkGapPanel";

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
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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

            {/* === OPERATOR ROUTES: Admin/Internal only === */}
            {/* Monitoring */}
            <Route path="/operator/ingestion-health" element={
              <OperatorGuard><OperatorIngestionHealthPage /></OperatorGuard>
            } />
            <Route path="/operator/cron-audit" element={
              <OperatorGuard><OperatorPlaceholderPage title="Cron Audit Log" description="View scheduled task execution history" /></OperatorGuard>
            } />
            <Route path="/operator/trap-health" element={
              <OperatorGuard><OperatorPlaceholderPage title="Trap Health Alerts" description="Monitor trap failures and issues" /></OperatorGuard>
            } />
            <Route path="/operator/job-queue" element={
              <OperatorGuard><OperatorPlaceholderPage title="Job Queue" description="View and manage background jobs" /></OperatorGuard>
            } />

            {/* Data Ops */}
            <Route path="/operator/traps" element={
              <OperatorGuard><OperatorPlaceholderPage title="Traps Registry" description="Manage dealer traps and configurations" /></OperatorGuard>
            } />
            <Route path="/operator/preflight" element={
              <OperatorGuard><OperatorPlaceholderPage title="Preflight Queue" description="View pending preflight checks" /></OperatorGuard>
            } />
            <Route path="/operator/validation" element={
              <OperatorGuard><OperatorPlaceholderPage title="Validation Queue" description="Monitor validation runs" /></OperatorGuard>
            } />
            <Route path="/operator/ingestion-runs" element={
              <OperatorGuard><OperatorPlaceholderPage title="Ingestion Runs" description="View ingestion run history" /></OperatorGuard>
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

            {/* Admin */}
            <Route path="/operator/dealer-onboarding" element={
              <OperatorGuard><OperatorPlaceholderPage title="Dealer Onboarding" description="Add and configure new dealers" /></OperatorGuard>
            } />
            <Route path="/operator/feature-flags" element={
              <OperatorGuard><OperatorPlaceholderPage title="Feature Flags" description="Toggle features and rollouts" /></OperatorGuard>
            } />
            <Route path="/operator/settings" element={
              <OperatorGuard><OperatorPlaceholderPage title="Settings" description="System configuration" /></OperatorGuard>
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

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
