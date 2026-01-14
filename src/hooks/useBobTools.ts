import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBobSiteContext, BobRuntimeContext } from '@/contexts/BobSiteContext';

// ============================================================================
// BOB TOOLS HOOK - Client-side interface for Bob's site-aware tools
// ============================================================================

export interface BobOpportunity {
  lot_id: string;
  year: number;
  make: string;
  model: string;
  variant: string;
  km: number;
  asking_price: number;
  location: string;
  auction_house: string;
  listing_url: string;
  status: 'BUY_NOW' | 'WATCH' | 'REVIEW';
  relevance_score: number;
  edge_reasons: string[];
  next_action: string;
}

export interface BobAuctionCard {
  auction_event_id?: string;
  auction_house: string;
  state: string | null;
  location_label: string;
  event_datetime: string;
  total_lots: number;
  eligible_lots: number;
  relevant_lots: number;
  heat_tier: 'COLD' | 'WARM' | 'HOT' | 'VERY_HOT';
  warnings: string[];
}

export interface BobWatchlistItem {
  lot_id: string;
  title: string;
  auction_house: string;
  location: string;
  why: string;
  status: 'WATCH' | 'PINNED';
  last_seen: string;
}

export interface BobLotExplanation {
  lot: {
    lot_id: string;
    year: number;
    make: string;
    model: string;
    variant: string;
    km: number;
    location: string;
    auction_house: string;
    asking_price: number;
  };
  eligibility: {
    passed: boolean;
    checks: string[];
  };
  fingerprint: {
    fingerprint: string;
    match_strength: number;
    sample_size: number;
    median_profit: number;
  };
  market_context: {
    comp_count: number;
    median_price: number;
    km_adjusted_band: number[];
  };
  flags: string[];
  recommended_action: 'BUY_NOW' | 'WATCH' | 'REVIEW';
  what_would_upgrade_to_buy: string[];
}

async function callBobTool<T>(
  tool: string,
  params: Record<string, unknown>,
  context?: BobRuntimeContext | null
): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke('bob-site-tools', {
      body: { tool, params, context }
    });

    if (error) {
      console.error(`[BobTools] ${tool} error:`, error);
      return null;
    }

    return data?.data as T;
  } catch (err) {
    console.error(`[BobTools] ${tool} exception:`, err);
    return null;
  }
}

export function useBobTools() {
  const { getContextPayload, runtimeContext } = useBobSiteContext();

  const getTodayOpportunities = useCallback(async (): Promise<{ items: BobOpportunity[]; counts: { total: number } } | null> => {
    const context = getContextPayload();
    if (!context?.dealer_id) return null;

    return callBobTool('get_today_opportunities', {
      dealer_id: context.dealer_id,
      filters: context.filters,
    }, context);
  }, [getContextPayload]);

  const getUpcomingAuctionCards = useCallback(async (): Promise<{ cards: BobAuctionCard[] } | null> => {
    const context = getContextPayload();
    if (!context?.dealer_id) return null;

    return callBobTool('get_upcoming_auction_cards', {
      dealer_id: context.dealer_id,
      filters: context.filters,
    }, context);
  }, [getContextPayload]);

  const getWatchlist = useCallback(async (): Promise<{ watchlist: BobWatchlistItem[] } | null> => {
    const context = getContextPayload();
    if (!context?.dealer_id) return null;

    return callBobTool('get_watchlist', {
      dealer_id: context.dealer_id,
    }, context);
  }, [getContextPayload]);

  const explainWhyListed = useCallback(async (lot_id: string): Promise<BobLotExplanation | null> => {
    const context = getContextPayload();
    if (!context?.dealer_id) return null;

    return callBobTool('explain_why_listed', {
      dealer_id: context.dealer_id,
      lot_id,
    }, context);
  }, [getContextPayload]);

  const getAuctionLots = useCallback(async (
    auction_event_id: string,
    mode: 'all' | 'eligible' | 'relevant' = 'all'
  ): Promise<{ lots: Array<{
    lot_id: string;
    year: number;
    make: string;
    model: string;
    variant: string;
    km: number;
    asking_price: number;
    listing_url: string;
    eligible: boolean;
    relevant: boolean;
    relevance_score: number;
    flags: string[];
  }> } | null> => {
    const context = getContextPayload();
    if (!context?.dealer_id) return null;

    return callBobTool('get_auction_lots', {
      dealer_id: context.dealer_id,
      auction_event_id,
      mode,
    }, context);
  }, [getContextPayload]);

  // Build context summary for Bob's system prompt
  const getContextSummary = useCallback((): string => {
    if (!runtimeContext) return '';

    const { route, filters, selection, page_summary } = runtimeContext;
    
    const parts: string[] = [];
    parts.push(`Current page: ${route}`);
    
    if (filters.auction_house !== 'ALL') {
      parts.push(`Auction house filter: ${filters.auction_house}`);
    }
    if (filters.location !== 'ALL') {
      parts.push(`Location filter: ${filters.location}`);
    }
    
    if (selection.lot_id) {
      parts.push(`Selected lot: ${selection.lot_id}`);
    }
    if (selection.auction_event_id) {
      parts.push(`Selected auction: ${selection.auction_event_id}`);
    }
    
    if (page_summary.eligible_lots_today > 0) {
      parts.push(`Eligible lots today: ${page_summary.eligible_lots_today}`);
    }
    if (page_summary.top_auctions_today.length > 0) {
      const topNames = page_summary.top_auctions_today
        .slice(0, 3)
        .map(a => `${a.auction_house} @ ${a.location} (${a.relevant} relevant)`)
        .join(', ');
      parts.push(`Top auctions: ${topNames}`);
    }

    return parts.join('. ');
  }, [runtimeContext]);

  return {
    getTodayOpportunities,
    getUpcomingAuctionCards,
    getWatchlist,
    explainWhyListed,
    getAuctionLots,
    getContextSummary,
    runtimeContext,
  };
}
