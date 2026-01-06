import { useState, useEffect, useCallback } from 'react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';

// ============================================================================
// FEATURE FLAGS: Organization-level feature toggles
// ============================================================================
// Flags are stored in the Settings sheet as key-value pairs.
// Format: feature_flag_{flag_name} = "enabled" | "disabled" | "internal_only"
//
// Visibility modes:
// - "disabled": Feature is completely off for everyone
// - "internal_only": Feature is on but only visible to admins
// - "enabled": Feature is on for everyone
// ============================================================================

export type FeatureFlagValue = 'enabled' | 'disabled' | 'internal_only';

export interface FeatureFlags {
  geoLiquidity: FeatureFlagValue;
  // Add more feature flags here as needed
}

const DEFAULT_FLAGS: FeatureFlags = {
  geoLiquidity: 'internal_only', // Default: generate signals but only show to admins
};

// Cache for flag values to avoid repeated API calls
let flagsCache: FeatureFlags | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

export function useFeatureFlags() {
  const { isAdmin } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadFlags = async () => {
      // Check cache first
      const now = Date.now();
      if (flagsCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        setFlags(flagsCache);
        setLoading(false);
        return;
      }

      try {
        // Load geo-liquidity flag from settings
        const geoLiquidityValue = await dataService.getSetting('feature_flag_geo_liquidity');
        
        const loadedFlags: FeatureFlags = {
          geoLiquidity: parseFlag(geoLiquidityValue) ?? DEFAULT_FLAGS.geoLiquidity,
        };

        flagsCache = loadedFlags;
        cacheTimestamp = now;
        setFlags(loadedFlags);
      } catch (error) {
        console.error('Failed to load feature flags:', error);
        setFlags(DEFAULT_FLAGS);
      } finally {
        setLoading(false);
      }
    };

    loadFlags();
  }, []);

  // Check if a feature should be visible to the current user
  const isFeatureVisible = useCallback((flagName: keyof FeatureFlags): boolean => {
    const value = flags[flagName];
    
    if (value === 'disabled') return false;
    if (value === 'enabled') return true;
    if (value === 'internal_only') return isAdmin;
    
    return false;
  }, [flags, isAdmin]);

  // Check if a feature is enabled (for computing data regardless of visibility)
  const isFeatureEnabled = useCallback((flagName: keyof FeatureFlags): boolean => {
    const value = flags[flagName];
    return value === 'enabled' || value === 'internal_only';
  }, [flags]);

  return {
    flags,
    loading,
    isFeatureVisible,
    isFeatureEnabled,
  };
}

// Parse a flag value from settings string
function parseFlag(value: string | null): FeatureFlagValue | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'enabled') return 'enabled';
  if (normalized === 'disabled') return 'disabled';
  if (normalized === 'internal_only' || normalized === 'internal') return 'internal_only';
  return null;
}

// Utility to invalidate the cache (call after updating flags)
export function invalidateFeatureFlagsCache() {
  flagsCache = null;
  cacheTimestamp = 0;
}
