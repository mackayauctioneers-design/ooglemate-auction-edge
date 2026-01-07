// ============================================================================
// REGIONAL DASHBOARD SERVICE
// ============================================================================
// Fetches geo-liquidity metrics and heat alerts for regional dashboards.
// ============================================================================

import { supabase } from '@/integrations/supabase/client';

// Region configuration
export interface RegionConfig {
  region_id: string;
  label: string;
  anchor_dealer?: string;
}

// Pre-defined regions
export const REGIONS: RegionConfig[] = [
  { region_id: 'CENTRAL_COAST_NSW', label: 'Central Coast NSW', anchor_dealer: 'Brian Hilton Toyota' },
  { region_id: 'NSW_SYDNEY', label: 'Sydney Metro' },
  { region_id: 'NSW_HUNTER', label: 'Hunter Region' },
  { region_id: 'VIC_MELBOURNE', label: 'Melbourne Metro' },
  { region_id: 'QLD_BRISBANE', label: 'Brisbane Metro' },
  { region_id: 'SA_ADELAIDE', label: 'Adelaide Metro' },
  { region_id: 'WA_PERTH', label: 'Perth Metro' },
];

// Heat alert from database
export interface GeoHeatAlert {
  id: string;
  alert_id: string;
  region_id: string;
  region_label: string | null;
  make: string;
  model: string;
  variant_bucket: string;
  tier: string;
  status: string;
  metric_type: string;
  value_short: number | null;
  value_long: number | null;
  pct_change: number | null;
  sample_short: number | null;
  dealer_share_short: number | null;
  confidence: string | null;
  title: string | null;
  subtitle: string | null;
  tagline: string | null;
  asof_date: string;
  created_at: string;
  acknowledged_at: string | null;
}

// Daily metrics from database
export interface GeoModelMetric {
  make: string;
  model: string;
  variant_bucket: string;
  region_id: string;
  metric_date: string;
  w_avg_days_to_clear: number | null;
  w_clear_count: number | null;
  w_listing_count: number | null;
  w_relist_rate: number | null;
  w_dealer_share: number | null;
}

// Regional summary for dashboard
export interface RegionalSummary {
  region: RegionConfig;
  active_alerts: number;
  hot_models: GeoHeatAlert[];
  cooling_models: GeoHeatAlert[];
  total_listings_7d: number;
  avg_days_to_clear_7d: number | null;
}

/**
 * Fetch active heat alerts for a specific region
 */
export async function getRegionAlerts(regionId: string): Promise<GeoHeatAlert[]> {
  const { data, error } = await supabase
    .from('geo_heat_alerts')
    .select('*')
    .eq('region_id', regionId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching region alerts:', error);
    return [];
  }

  return data as GeoHeatAlert[];
}

/**
 * Fetch recent metrics for a specific region (last 7 days)
 */
export async function getRegionMetrics(regionId: string, days: number = 7): Promise<GeoModelMetric[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('geo_model_metrics_daily')
    .select('*')
    .eq('region_id', regionId)
    .gte('metric_date', startDateStr)
    .order('metric_date', { ascending: false });

  if (error) {
    console.error('Error fetching region metrics:', error);
    return [];
  }

  return data as GeoModelMetric[];
}

/**
 * Get summary for a specific region
 */
export async function getRegionalSummary(regionConfig: RegionConfig): Promise<RegionalSummary> {
  const alerts = await getRegionAlerts(regionConfig.region_id);
  const metrics = await getRegionMetrics(regionConfig.region_id);

  // Categorize alerts
  const hotModels = alerts.filter(a => 
    a.tier === 'EARLY_PRIVATE_LED' || a.tier === 'CONFIRMED_DEALER_VALIDATED'
  );
  const coolingModels = alerts.filter(a => a.tier === 'COOLING');

  // Aggregate metrics
  const totalListings = metrics.reduce((sum, m) => sum + (m.w_listing_count || 0), 0);
  const clearanceDays = metrics
    .filter(m => m.w_avg_days_to_clear !== null)
    .map(m => m.w_avg_days_to_clear!);
  const avgDaysToClear = clearanceDays.length > 0
    ? clearanceDays.reduce((a, b) => a + b, 0) / clearanceDays.length
    : null;

  return {
    region: regionConfig,
    active_alerts: alerts.length,
    hot_models: hotModels.slice(0, 10),
    cooling_models: coolingModels.slice(0, 5),
    total_listings_7d: totalListings,
    avg_days_to_clear_7d: avgDaysToClear,
  };
}

/**
 * Get summaries for all configured regions
 */
export async function getAllRegionSummaries(): Promise<RegionalSummary[]> {
  const summaries = await Promise.all(
    REGIONS.map(region => getRegionalSummary(region))
  );
  return summaries;
}

/**
 * Get top heat alerts across all regions (for dashboard overview)
 */
export async function getTopHeatAlerts(limit: number = 20): Promise<GeoHeatAlert[]> {
  const { data, error } = await supabase
    .from('geo_heat_alerts')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching top heat alerts:', error);
    return [];
  }

  return data as GeoHeatAlert[];
}
