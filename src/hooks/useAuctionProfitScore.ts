import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LotProfitScore {
  listing_id: string;
  score: number;
  median_gp: number | null;
  win_rate: number | null;
  sample_size: number;
  geo_multiplier: number;
  confidence_label: 'high' | 'medium' | 'low';
}

export interface AuctionProfitScore {
  auction_key: string;
  score: number;
  profit_dense_count: number;
  top_fingerprints: string[];
  sample_size: number;
  confidence_label: 'high' | 'medium' | 'low';
}

type HeatLevel = 'hot' | 'warm' | 'cold';

export function getProfitHeatLevel(score: number): HeatLevel {
  if (score >= 7.5) return 'hot';
  if (score >= 6.0) return 'warm';
  return 'cold';
}

// Calculate per-lot profit score (0-10) from fingerprint stats
function calculateLotScore(
  medianGp: number | null,
  winRate: number | null,
  medianDaysToExit: number | null,
  sampleSize: number,
  variantConfidence: number,
  geoMultiplier: number,
  gpTarget: number = 4000,
  exitTargetDays: number = 21
): number {
  // Profit factor (P) - normalize median GP to 0-1
  const P = medianGp ? Math.min(Math.max(medianGp / gpTarget, 0), 1) : 0;
  
  // Win-rate factor (W)
  const W = winRate ? Math.min(Math.max(winRate, 0), 1) : 0;
  
  // Exit speed factor (D) - optional
  let D = 0.5; // default if no exit data
  if (medianDaysToExit !== null) {
    D = Math.min(Math.max(1 - (medianDaysToExit / exitTargetDays), 0), 1);
  }
  
  // Sample size factor (S) - caps benefit around ~20 samples
  const S = Math.min(Math.max(Math.log10(sampleSize + 1) / Math.log10(21), 0), 1);
  
  // Confidence factor (C)
  const recordConfidence = sampleSize >= 5 ? 1 : sampleSize >= 3 ? 0.8 : 0.5;
  const C = Math.min(Math.max(0.5 + 0.5 * (variantConfidence * recordConfidence), 0.5), 1);
  
  // Weighted score (0-10) with geo multiplier
  let score = 10 * (0.45 * P + 0.25 * W + 0.15 * D + 0.10 * S + 0.05 * C) * geoMultiplier;
  
  // Cap score if sample size < 3
  if (sampleSize < 3) {
    score = Math.min(score, 6.0);
  }
  
  return Math.round(score * 10) / 10; // Round to 1 decimal
}

function getConfidenceLabel(sampleSize: number): 'high' | 'medium' | 'low' {
  if (sampleSize >= 10) return 'high';
  if (sampleSize >= 5) return 'medium';
  return 'low';
}

export function useAuctionProfitScores(
  auctionKeys: string[], // Format: "house|date|location"
  enabled: boolean = true
) {
  const { dealerProfile } = useAuth();
  const dealerRegion = dealerProfile?.region_id || 'NSW_SYDNEY_METRO';

  // Fetch fingerprint profit stats
  const { data: profitStats = [], isLoading } = useQuery({
    queryKey: ['fingerprintProfitStats', dealerRegion],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fingerprint_profit_stats')
        .select('*')
        .or(`region_id.eq.${dealerRegion},region_id.eq.NATIONAL`);
      
      if (error) throw error;
      return data || [];
    },
    enabled: enabled && auctionKeys.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Create a lookup map for profit stats by fingerprint
  const statsMap = useMemo(() => {
    const map = new Map<string, typeof profitStats[0]>();
    profitStats.forEach((stat) => {
      // Prefer region-specific stats over national
      const existing = map.get(stat.fingerprint);
      if (!existing || (stat.region_id === dealerRegion && existing.region_id !== dealerRegion)) {
        map.set(stat.fingerprint, stat);
      }
    });
    return map;
  }, [profitStats, dealerRegion]);

  return {
    statsMap,
    isLoading,
    calculateLotScore,
    getConfidenceLabel,
    dealerRegion,
  };
}

// Hook to calculate auction-level profit scores
export function useAuctionScoreCalculator() {
  const calculateAuctionScore = (
    lotScores: number[],
    topN: number = 10
  ): { score: number; profitDenseCount: number } => {
    if (lotScores.length === 0) {
      return { score: 0, profitDenseCount: 0 };
    }
    
    // Sort descending and take top N
    const sorted = [...lotScores].sort((a, b) => b - a);
    const topScores = sorted.slice(0, topN);
    
    // Average of top N scores
    const score = topScores.reduce((sum, s) => sum + s, 0) / topScores.length;
    
    // Count of lots with score >= 6.0
    const profitDenseCount = lotScores.filter((s) => s >= 6.0).length;
    
    return {
      score: Math.round(score * 10) / 10,
      profitDenseCount,
    };
  };

  return { calculateAuctionScore };
}
