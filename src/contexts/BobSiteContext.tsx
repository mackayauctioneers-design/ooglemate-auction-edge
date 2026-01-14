import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';

// ============================================================================
// BOB SITE CONTEXT - Makes Bob "site-aware" with Live Eyes + Dealer Brain
// ============================================================================

// Filter state for Bob's current view
export interface BobFilters {
  auction_house: 'ALL' | 'Pickles' | 'Manheim' | 'Grays' | string;
  location: 'ALL' | 'NSW' | 'QLD' | 'VIC' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT' | 'Unknown' | string;
  date_window_days: number;
  eligible_only: boolean;
  relevant_only: boolean;
}

// Current selection in the app
export interface BobSelection {
  auction_event_id: string | null;
  lot_id: string | null;
}

// Top auction summary for page context
export interface TopAuctionSummary {
  auction_event_id: string;
  auction_house: string;
  location: string;
  relevant: number;
  eligible: number;
  total: number;
}

// Page summary for context
export interface PageSummary {
  eligible_lots_today: number;
  top_auctions_today: TopAuctionSummary[];
}

// Full runtime context sent to Bob on every message
export interface BobRuntimeContext {
  dealer_id: string;
  route: string;
  filters: BobFilters;
  selection: BobSelection;
  page_summary: PageSummary;
}

// Dealer profile (persistent brain)
export interface DealerProfile {
  year_min: number;
  year_max: number | null;
  exclude_salvage: boolean;
  exclude_wovr: boolean;
  exclude_stat_writeoff: boolean;
  preferred_segments: Array<{ make: string; model: string }>;
  exclude_segments: Array<{ make: string; model: string }>;
  geo_preferences: {
    prefer_states?: string[];
    penalize_unknown_location?: number;
  };
  scoring_thresholds: {
    cold_max: number;
    warm_max: number;
    hot_max: number;
    very_hot_min: number;
  };
  output_style: {
    format: string;
    max_items: number;
  };
}

interface BobSiteContextValue {
  // Current context
  runtimeContext: BobRuntimeContext | null;
  dealerProfile: DealerProfile | null;
  
  // Context setters
  setFilters: (filters: Partial<BobFilters>) => void;
  setSelection: (selection: Partial<BobSelection>) => void;
  setPageSummary: (summary: Partial<PageSummary>) => void;
  
  // Get full context for Bob API calls
  getContextPayload: () => BobRuntimeContext | null;
  
  // Refresh dealer profile
  refreshDealerProfile: () => Promise<void>;
  
  // Loading state
  isLoading: boolean;
}

const BobSiteContext = createContext<BobSiteContextValue | null>(null);

const DEFAULT_FILTERS: BobFilters = {
  auction_house: 'ALL',
  location: 'ALL',
  date_window_days: 14,
  eligible_only: true,
  relevant_only: false,
};

const DEFAULT_PAGE_SUMMARY: PageSummary = {
  eligible_lots_today: 0,
  top_auctions_today: [],
};

const DEFAULT_DEALER_PROFILE: DealerProfile = {
  year_min: 2020,
  year_max: null,
  exclude_salvage: true,
  exclude_wovr: true,
  exclude_stat_writeoff: true,
  preferred_segments: [],
  exclude_segments: [],
  geo_preferences: {},
  scoring_thresholds: { cold_max: 1, warm_max: 4, hot_max: 9, very_hot_min: 10 },
  output_style: { format: 'operator', max_items: 7 },
};

export function BobSiteContextProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  
  const [filters, setFiltersState] = useState<BobFilters>(DEFAULT_FILTERS);
  const [selection, setSelectionState] = useState<BobSelection>({ auction_event_id: null, lot_id: null });
  const [pageSummary, setPageSummaryState] = useState<PageSummary>(DEFAULT_PAGE_SUMMARY);
  const [dealerProfile, setDealerProfile] = useState<DealerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch dealer profile on mount/user change
  const refreshDealerProfile = useCallback(async () => {
    if (!user?.id) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_get_dealer_profile', {
        p_dealer_id: user.id
      });
      
      if (error) {
        console.error('[BobContext] Error fetching dealer profile:', error);
        setDealerProfile(DEFAULT_DEALER_PROFILE);
      } else if (data) {
        // Type assertion through unknown for jsonb response
        setDealerProfile(data as unknown as DealerProfile);
      }
    } catch (err) {
      console.error('[BobContext] Exception fetching dealer profile:', err);
      setDealerProfile(DEFAULT_DEALER_PROFILE);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Load dealer profile on user change
  useEffect(() => {
    if (user?.id) {
      refreshDealerProfile();
    } else {
      setDealerProfile(null);
    }
  }, [user?.id, refreshDealerProfile]);

  // Build runtime context
  const runtimeContext = useMemo((): BobRuntimeContext | null => {
    if (!user?.id) return null;
    
    return {
      dealer_id: user.id,
      route: location.pathname,
      filters,
      selection,
      page_summary: pageSummary,
    };
  }, [user?.id, location.pathname, filters, selection, pageSummary]);

  // Setters that merge with existing state
  const setFilters = useCallback((newFilters: Partial<BobFilters>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
  }, []);

  const setSelection = useCallback((newSelection: Partial<BobSelection>) => {
    setSelectionState(prev => ({ ...prev, ...newSelection }));
  }, []);

  const setPageSummary = useCallback((newSummary: Partial<PageSummary>) => {
    setPageSummaryState(prev => ({ ...prev, ...newSummary }));
  }, []);

  // Get context payload for API calls
  const getContextPayload = useCallback((): BobRuntimeContext | null => {
    return runtimeContext;
  }, [runtimeContext]);

  const value: BobSiteContextValue = {
    runtimeContext,
    dealerProfile,
    setFilters,
    setSelection,
    setPageSummary,
    getContextPayload,
    refreshDealerProfile,
    isLoading,
  };

  return (
    <BobSiteContext.Provider value={value}>
      {children}
    </BobSiteContext.Provider>
  );
}

export function useBobSiteContext() {
  const context = useContext(BobSiteContext);
  if (!context) {
    throw new Error('useBobSiteContext must be used within a BobSiteContextProvider');
  }
  return context;
}

// Hook for pages to update context when data changes
export function useBobPageContext() {
  const { setFilters, setSelection, setPageSummary } = useBobSiteContext();
  
  const updateAuctionContext = useCallback((data: {
    eligible_lots?: number;
    top_auctions?: TopAuctionSummary[];
    filters?: Partial<BobFilters>;
  }) => {
    if (data.eligible_lots !== undefined || data.top_auctions !== undefined) {
      setPageSummary({
        eligible_lots_today: data.eligible_lots ?? 0,
        top_auctions_today: data.top_auctions ?? [],
      });
    }
    if (data.filters) {
      setFilters(data.filters);
    }
  }, [setFilters, setPageSummary]);

  const selectLot = useCallback((lot_id: string | null) => {
    setSelection({ lot_id });
  }, [setSelection]);

  const selectAuction = useCallback((auction_event_id: string | null) => {
    setSelection({ auction_event_id });
  }, [setSelection]);

  return {
    updateAuctionContext,
    selectLot,
    selectAuction,
  };
}
