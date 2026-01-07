import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminGuard } from "@/components/guards/AdminGuard";
import OpportunitiesPage from "./pages/OpportunitiesPage";
import LogSalePage from "./pages/LogSalePage";
import FingerprintsPage from "./pages/FingerprintsPage";
import AlertsPage from "./pages/AlertsPage";
import HelpPage from "./pages/HelpPage";
import UpcomingAuctionsPage from "./pages/UpcomingAuctionsPage";
import SearchLotsPage from "./pages/SearchLotsPage";
import SalesReviewPage from "./pages/SalesReviewPage";
import MatchesPage from "./pages/MatchesPage";
import SavedSearchesPage from "./pages/SavedSearchesPage";
import AdminToolsPage from "./pages/AdminToolsPage";
import ValuationPage from "./pages/ValuationPage";
import ValoPage from "./pages/ValoPage";
import BuyerReviewQueuePage from "./pages/BuyerReviewQueuePage";
import PicklesIngestionPage from "./pages/PicklesIngestionPage";
import RegionalDashboardPage from "./pages/RegionalDashboardPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// ============================================================================
// ROUTING: DEALER MODE vs ADMIN MODE
// ============================================================================
// PHASE 3: VALO/Ask Bob is admin-only during testing phase.
// Routes wrapped in <AdminGuard> redirect non-admins to home page.
// 
// - Admin-only (Phase 3): valo, log-sale, sales-review, fingerprints, 
//                         saved-searches, alerts, admin-tools, buyer-review-queue
// - Shared: /, upcoming-auctions, search-lots, matches, valuation, help
// ============================================================================

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* === SHARED ROUTES: All users === */}
            <Route path="/" element={<OpportunitiesPage />} />
            <Route path="/upcoming-auctions" element={<UpcomingAuctionsPage />} />
            <Route path="/search-lots" element={<SearchLotsPage />} />
            <Route path="/matches" element={<MatchesPage />} />
            <Route path="/valuation" element={<ValuationPage />} />
            <Route path="/help" element={<HelpPage />} />
            
            {/* === VALO/Ask Bob: Available to all authenticated users === */}
            <Route path="/valo" element={<ValoPage />} />
            
            {/* === ADMIN-ONLY ROUTES: Redirect non-admins to home === */}
            <Route path="/log-sale" element={
              <AdminGuard><LogSalePage /></AdminGuard>
            } />
            <Route path="/sales-review" element={
              <AdminGuard><SalesReviewPage /></AdminGuard>
            } />
            <Route path="/fingerprints" element={
              <AdminGuard><FingerprintsPage /></AdminGuard>
            } />
            <Route path="/saved-searches" element={
              <AdminGuard><SavedSearchesPage /></AdminGuard>
            } />
            <Route path="/alerts" element={
              <AdminGuard><AlertsPage /></AdminGuard>
            } />
            <Route path="/admin-tools" element={
              <AdminGuard><AdminToolsPage /></AdminGuard>
            } />
            <Route path="/buyer-review-queue" element={
              <AdminGuard><BuyerReviewQueuePage /></AdminGuard>
            } />
            <Route path="/pickles-ingestion" element={
              <AdminGuard><PicklesIngestionPage /></AdminGuard>
            } />
            <Route path="/regional-dashboard" element={
              <AdminGuard><RegionalDashboardPage /></AdminGuard>
            } />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
