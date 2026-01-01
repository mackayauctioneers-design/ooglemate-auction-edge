import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import OpportunitiesPage from "./pages/OpportunitiesPage";
import LogSalePage from "./pages/LogSalePage";
import FingerprintsPage from "./pages/FingerprintsPage";
import AlertsPage from "./pages/AlertsPage";
import HelpPage from "./pages/HelpPage";
import UpcomingAuctionsPage from "./pages/UpcomingAuctionsPage";
import SearchLotsPage from "./pages/SearchLotsPage";
import SalesReviewPage from "./pages/SalesReviewPage";
import MatchesPage from "./pages/MatchesPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<OpportunitiesPage />} />
            <Route path="/upcoming-auctions" element={<UpcomingAuctionsPage />} />
            <Route path="/search-lots" element={<SearchLotsPage />} />
            <Route path="/matches" element={<MatchesPage />} />
            <Route path="/log-sale" element={<LogSalePage />} />
            <Route path="/sales-review" element={<SalesReviewPage />} />
            <Route path="/fingerprints" element={<FingerprintsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
