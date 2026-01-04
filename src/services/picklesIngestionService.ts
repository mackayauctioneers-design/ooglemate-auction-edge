import { supabase } from "@/integrations/supabase/client";

export interface IngestionResult {
  success: boolean;
  runId?: string;
  lotsFound?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  error?: string;
}

export interface AlertResult {
  success: boolean;
  alertsCreated?: number;
  alertsSkipped?: number;
  alertDetails?: { dealer: string; listing: string; type: string }[];
  error?: string;
}

export interface IngestionRun {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  lots_found: number;
  lots_created: number;
  lots_updated: number;
  errors: string[];
  metadata: Record<string, unknown>;
}

export interface VehicleListing {
  id: string;
  listing_id: string;
  lot_id: string;
  source: string;
  auction_house: string;
  make: string;
  model: string;
  variant_raw: string | null;
  variant_family: string | null;
  year: number;
  km: number | null;
  status: string;
  location: string | null;
  auction_datetime: string | null;
  listing_url: string | null;
  pass_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface DealerFingerprint {
  id: string;
  fingerprint_id: string;
  dealer_name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  is_spec_only: boolean;
  is_active: boolean;
}

export interface AlertLog {
  id: string;
  alert_id: string;
  dealer_name: string;
  listing_id: string;
  fingerprint_id: string;
  alert_type: string;
  action_reason: string | null;
  match_type: string;
  message_text: string;
  status: string;
  created_at: string;
  lot_make: string | null;
  lot_model: string | null;
  lot_variant: string | null;
  lot_year: number | null;
  auction_house: string | null;
  location: string | null;
}

export interface CrawlResult {
  success: boolean;
  runId?: string;
  pagesProcessed?: number;
  totalListings?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  error?: string;
}

// Run Pickles pagination crawl
export async function runPicklesCrawl(
  baseUrl?: string,
  maxPages: number = 20,
  startPage: number = 1
): Promise<CrawlResult> {
  try {
    const { data, error } = await supabase.functions.invoke('pickles-crawl', {
      body: { baseUrl, maxPages, startPage }
    });

    if (error) throw error;
    return data as CrawlResult;
  } catch (e) {
    console.error('[picklesIngestionService] Crawl error:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
}

// Run Pickles catalogue ingestion
export async function runPicklesIngestion(
  catalogueText: string,
  eventId: string,
  auctionDate: string
): Promise<IngestionResult> {
  try {
    const { data, error } = await supabase.functions.invoke('pickles-ingest', {
      body: { catalogueText, eventId, auctionDate }
    });

    if (error) throw error;
    return data as IngestionResult;
  } catch (e) {
    console.error('[picklesIngestionService] Ingestion error:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
}

// Run Pickles alert processing
export async function runPicklesAlerts(
  alertType: 'UPCOMING' | 'ACTION' = 'UPCOMING',
  listingIds?: string[]
): Promise<AlertResult> {
  try {
    const { data, error } = await supabase.functions.invoke('pickles-alerts', {
      body: { alertType, listingIds }
    });

    if (error) throw error;
    return data as AlertResult;
  } catch (e) {
    console.error('[picklesIngestionService] Alert error:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
}

// Get recent ingestion runs
export async function getIngestionRuns(limit = 10): Promise<IngestionRun[]> {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[picklesIngestionService] Error fetching runs:', error);
    return [];
  }

  return data as IngestionRun[];
}

// Get vehicle listings
export async function getVehicleListings(filters?: {
  source?: string;
  status?: string;
  make?: string;
  model?: string;
}): Promise<VehicleListing[]> {
  let query = supabase
    .from('vehicle_listings')
    .select('*')
    .order('last_seen_at', { ascending: false })
    .limit(100);

  if (filters?.source) query = query.eq('source', filters.source);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.make) query = query.ilike('make', `%${filters.make}%`);
  if (filters?.model) query = query.ilike('model', `%${filters.model}%`);

  const { data, error } = await query;

  if (error) {
    console.error('[picklesIngestionService] Error fetching listings:', error);
    return [];
  }

  return data as VehicleListing[];
}

// Get fingerprints
export async function getFingerprints(dealerName?: string): Promise<DealerFingerprint[]> {
  let query = supabase
    .from('dealer_fingerprints')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (dealerName) query = query.eq('dealer_name', dealerName);

  const { data, error } = await query;

  if (error) {
    console.error('[picklesIngestionService] Error fetching fingerprints:', error);
    return [];
  }

  return data as DealerFingerprint[];
}

// Get alerts
export async function getAlerts(dealerName?: string, status?: string): Promise<AlertLog[]> {
  let query = supabase
    .from('alert_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (dealerName) query = query.eq('dealer_name', dealerName);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    console.error('[picklesIngestionService] Error fetching alerts:', error);
    return [];
  }

  return data as AlertLog[];
}
