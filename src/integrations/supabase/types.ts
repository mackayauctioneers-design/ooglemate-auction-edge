export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alert_logs: {
        Row: {
          acknowledged_at: string | null
          action_reason: string | null
          alert_id: string
          alert_type: string
          auction_datetime: string | null
          auction_house: string | null
          created_at: string
          dealer_name: string
          dealer_profile_id: string | null
          dedup_key: string
          fingerprint_id: string
          id: string
          listing_id: string
          listing_url: string | null
          location: string | null
          lot_make: string | null
          lot_model: string | null
          lot_variant: string | null
          lot_year: number | null
          match_type: string
          message_text: string
          previous_status: string | null
          push_sent_at: string | null
          queued_until: string | null
          read_at: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          action_reason?: string | null
          alert_id: string
          alert_type: string
          auction_datetime?: string | null
          auction_house?: string | null
          created_at?: string
          dealer_name: string
          dealer_profile_id?: string | null
          dedup_key: string
          fingerprint_id: string
          id?: string
          listing_id: string
          listing_url?: string | null
          location?: string | null
          lot_make?: string | null
          lot_model?: string | null
          lot_variant?: string | null
          lot_year?: number | null
          match_type?: string
          message_text: string
          previous_status?: string | null
          push_sent_at?: string | null
          queued_until?: string | null
          read_at?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          action_reason?: string | null
          alert_id?: string
          alert_type?: string
          auction_datetime?: string | null
          auction_house?: string | null
          created_at?: string
          dealer_name?: string
          dealer_profile_id?: string | null
          dedup_key?: string
          fingerprint_id?: string
          id?: string
          listing_id?: string
          listing_url?: string | null
          location?: string | null
          lot_make?: string | null
          lot_model?: string | null
          lot_variant?: string | null
          lot_year?: number | null
          match_type?: string
          message_text?: string
          previous_status?: string | null
          push_sent_at?: string | null
          queued_until?: string | null
          read_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_logs_dealer_profile_id_fkey"
            columns: ["dealer_profile_id"]
            isOneToOne: false
            referencedRelation: "dealer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clearance_events: {
        Row: {
          clearance_type: string
          cleared_at: string
          created_at: string
          days_to_clear: number
          id: number
          listing_id: string
        }
        Insert: {
          clearance_type: string
          cleared_at: string
          created_at?: string
          days_to_clear: number
          id?: number
          listing_id: string
        }
        Update: {
          clearance_type?: string
          cleared_at?: string
          created_at?: string
          days_to_clear?: number
          id?: number
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_crawl_runs: {
        Row: {
          created_at: string
          dealer_name: string
          dealer_slug: string
          drop_reasons: Json | null
          error: string | null
          id: string
          parser_mode: string
          run_completed_at: string | null
          run_date: string
          run_started_at: string
          vehicles_dropped: number
          vehicles_found: number
          vehicles_ingested: number
        }
        Insert: {
          created_at?: string
          dealer_name: string
          dealer_slug: string
          drop_reasons?: Json | null
          error?: string | null
          id?: string
          parser_mode: string
          run_completed_at?: string | null
          run_date?: string
          run_started_at?: string
          vehicles_dropped?: number
          vehicles_found?: number
          vehicles_ingested?: number
        }
        Update: {
          created_at?: string
          dealer_name?: string
          dealer_slug?: string
          drop_reasons?: Json | null
          error?: string | null
          id?: string
          parser_mode?: string
          run_completed_at?: string | null
          run_date?: string
          run_started_at?: string
          vehicles_dropped?: number
          vehicles_found?: number
          vehicles_ingested?: number
        }
        Relationships: []
      }
      dealer_fingerprints: {
        Row: {
          created_at: string
          dealer_name: string
          dealer_profile_id: string | null
          expires_at: string | null
          fingerprint_id: string
          id: string
          is_active: boolean
          is_spec_only: boolean
          make: string
          max_km: number | null
          min_km: number | null
          model: string
          updated_at: string
          variant_family: string | null
          year_max: number
          year_min: number
        }
        Insert: {
          created_at?: string
          dealer_name: string
          dealer_profile_id?: string | null
          expires_at?: string | null
          fingerprint_id: string
          id?: string
          is_active?: boolean
          is_spec_only?: boolean
          make: string
          max_km?: number | null
          min_km?: number | null
          model: string
          updated_at?: string
          variant_family?: string | null
          year_max: number
          year_min: number
        }
        Update: {
          created_at?: string
          dealer_name?: string
          dealer_profile_id?: string | null
          expires_at?: string | null
          fingerprint_id?: string
          id?: string
          is_active?: boolean
          is_spec_only?: boolean
          make?: string
          max_km?: number | null
          min_km?: number | null
          model?: string
          updated_at?: string
          variant_family?: string | null
          year_max?: number
          year_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "dealer_fingerprints_dealer_profile_id_fkey"
            columns: ["dealer_profile_id"]
            isOneToOne: false
            referencedRelation: "dealer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_profile_user_links: {
        Row: {
          dealer_profile_id: string
          id: string
          linked_at: string
          linked_by: string | null
          user_id: string
        }
        Insert: {
          dealer_profile_id: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          user_id: string
        }
        Update: {
          dealer_profile_id?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_profile_user_links_dealer_profile_id_fkey"
            columns: ["dealer_profile_id"]
            isOneToOne: true
            referencedRelation: "dealer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_profiles: {
        Row: {
          created_at: string
          dealer_name: string
          id: string
          org_id: string | null
          region_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dealer_name: string
          id?: string
          org_id?: string | null
          region_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dealer_name?: string
          id?: string
          org_id?: string | null
          region_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fingerprint_outcomes: {
        Row: {
          asof_date: string
          avg_days_to_clear: number | null
          avg_price: number | null
          cleared_total: number
          created_at: string
          example_listing_id: string | null
          fuel: string | null
          id: string
          km_band_max: number | null
          km_band_min: number | null
          listing_total: number
          make: string
          max_days_to_clear: number | null
          max_price: number | null
          min_days_to_clear: number | null
          min_price: number | null
          model: string
          passed_in_total: number
          region_id: string
          relisted_total: number
          transmission: string | null
          updated_at: string
          variant_family: string | null
          year_max: number
          year_min: number
        }
        Insert: {
          asof_date: string
          avg_days_to_clear?: number | null
          avg_price?: number | null
          cleared_total?: number
          created_at?: string
          example_listing_id?: string | null
          fuel?: string | null
          id?: string
          km_band_max?: number | null
          km_band_min?: number | null
          listing_total?: number
          make: string
          max_days_to_clear?: number | null
          max_price?: number | null
          min_days_to_clear?: number | null
          min_price?: number | null
          model: string
          passed_in_total?: number
          region_id: string
          relisted_total?: number
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          year_max: number
          year_min: number
        }
        Update: {
          asof_date?: string
          avg_days_to_clear?: number | null
          avg_price?: number | null
          cleared_total?: number
          created_at?: string
          example_listing_id?: string | null
          fuel?: string | null
          id?: string
          km_band_max?: number | null
          km_band_min?: number | null
          listing_total?: number
          make?: string
          max_days_to_clear?: number | null
          max_price?: number | null
          min_days_to_clear?: number | null
          min_price?: number | null
          model?: string
          passed_in_total?: number
          region_id?: string
          relisted_total?: number
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          year_max?: number
          year_min?: number
        }
        Relationships: []
      }
      geo_heat_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_id: string
          asof_date: string
          audience: string
          confidence: string | null
          created_at: string
          dealer_share_short: number | null
          expired_at: string | null
          feature_key: string
          id: string
          make: string
          metric_type: string
          model: string
          pct_change: number | null
          region_id: string
          region_label: string | null
          relist_rate_short: number | null
          sample_short: number | null
          status: string
          subtitle: string | null
          tagline: string | null
          tier: string
          title: string | null
          value_long: number | null
          value_short: number | null
          variant_bucket: string
          year_min: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_id: string
          asof_date: string
          audience?: string
          confidence?: string | null
          created_at?: string
          dealer_share_short?: number | null
          expired_at?: string | null
          feature_key?: string
          id?: string
          make: string
          metric_type?: string
          model: string
          pct_change?: number | null
          region_id: string
          region_label?: string | null
          relist_rate_short?: number | null
          sample_short?: number | null
          status?: string
          subtitle?: string | null
          tagline?: string | null
          tier: string
          title?: string | null
          value_long?: number | null
          value_short?: number | null
          variant_bucket?: string
          year_min?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_id?: string
          asof_date?: string
          audience?: string
          confidence?: string | null
          created_at?: string
          dealer_share_short?: number | null
          expired_at?: string | null
          feature_key?: string
          id?: string
          make?: string
          metric_type?: string
          model?: string
          pct_change?: number | null
          region_id?: string
          region_label?: string | null
          relist_rate_short?: number | null
          sample_short?: number | null
          status?: string
          subtitle?: string | null
          tagline?: string | null
          tier?: string
          title?: string | null
          value_long?: number | null
          value_short?: number | null
          variant_bucket?: string
          year_min?: number | null
        }
        Relationships: []
      }
      geo_model_metrics_daily: {
        Row: {
          created_at: string
          make: string
          metric_date: string
          model: string
          region_id: string
          variant_bucket: string
          w_avg_days_to_clear: number | null
          w_clear_count: number | null
          w_dealer_share: number | null
          w_listing_count: number | null
          w_relist_rate: number | null
        }
        Insert: {
          created_at?: string
          make: string
          metric_date: string
          model: string
          region_id: string
          variant_bucket?: string
          w_avg_days_to_clear?: number | null
          w_clear_count?: number | null
          w_dealer_share?: number | null
          w_listing_count?: number | null
          w_relist_rate?: number | null
        }
        Update: {
          created_at?: string
          make?: string
          metric_date?: string
          model?: string
          region_id?: string
          variant_bucket?: string
          w_avg_days_to_clear?: number | null
          w_clear_count?: number | null
          w_dealer_share?: number | null
          w_listing_count?: number | null
          w_relist_rate?: number | null
        }
        Relationships: []
      }
      ingestion_runs: {
        Row: {
          completed_at: string | null
          errors: Json | null
          id: string
          lots_created: number | null
          lots_found: number | null
          lots_updated: number | null
          metadata: Json | null
          source: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          errors?: Json | null
          id?: string
          lots_created?: number | null
          lots_found?: number | null
          lots_updated?: number | null
          metadata?: Json | null
          source: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          errors?: Json | null
          id?: string
          lots_created?: number | null
          lots_found?: number | null
          lots_updated?: number | null
          metadata?: Json | null
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      listing_snapshots: {
        Row: {
          asking_price: number | null
          created_at: string
          id: number
          km: number | null
          listing_id: string
          location: string | null
          reserve: number | null
          seen_at: string
          status: string | null
        }
        Insert: {
          asking_price?: number | null
          created_at?: string
          id?: never
          km?: number | null
          listing_id: string
          location?: string | null
          reserve?: number | null
          seen_at?: string
          status?: string | null
        }
        Update: {
          asking_price?: number | null
          created_at?: string
          id?: never
          km?: number | null
          listing_id?: string
          location?: string | null
          reserve?: number | null
          seen_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      valo_requests: {
        Row: {
          allow_price: boolean
          anchor_owe: number | null
          bob_response: string | null
          buy_high: number | null
          buy_low: number | null
          comps_used: string[]
          confidence: string | null
          created_at: string
          dealer_name: string | null
          demand_class: string | null
          engine: string | null
          id: string
          km: number | null
          location: string | null
          make: string
          model: string
          n_comps: number
          oanca_object: Json
          processing_time_ms: number | null
          raw_transcript: string | null
          transmission: string | null
          variant_family: string | null
          verdict: string
          year: number
        }
        Insert: {
          allow_price: boolean
          anchor_owe?: number | null
          bob_response?: string | null
          buy_high?: number | null
          buy_low?: number | null
          comps_used?: string[]
          confidence?: string | null
          created_at?: string
          dealer_name?: string | null
          demand_class?: string | null
          engine?: string | null
          id?: string
          km?: number | null
          location?: string | null
          make: string
          model: string
          n_comps?: number
          oanca_object: Json
          processing_time_ms?: number | null
          raw_transcript?: string | null
          transmission?: string | null
          variant_family?: string | null
          verdict: string
          year: number
        }
        Update: {
          allow_price?: boolean
          anchor_owe?: number | null
          bob_response?: string | null
          buy_high?: number | null
          buy_low?: number | null
          comps_used?: string[]
          confidence?: string | null
          created_at?: string
          dealer_name?: string | null
          demand_class?: string | null
          engine?: string | null
          id?: string
          km?: number | null
          location?: string | null
          make?: string
          model?: string
          n_comps?: number
          oanca_object?: Json
          processing_time_ms?: number | null
          raw_transcript?: string | null
          transmission?: string | null
          variant_family?: string | null
          verdict?: string
          year?: number
        }
        Relationships: []
      }
      valo_review_logs: {
        Row: {
          action: string
          actor: string
          created_at: string
          id: string
          new_values: Json | null
          note: string | null
          old_values: Json | null
          request_id: string
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          id?: string
          new_values?: Json | null
          note?: string | null
          old_values?: Json | null
          request_id: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          note?: string | null
          old_values?: Json | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valo_review_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "valo_review_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      valo_review_requests: {
        Row: {
          admin_buy_range_max: number | null
          admin_buy_range_min: number | null
          admin_note: string | null
          admin_response: string | null
          buy_range_max: number | null
          buy_range_min: number | null
          confidence: string
          created_at: string
          dealer_name: string
          frank_response: string
          id: string
          parsed_vehicle: Json
          photo_paths: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          sell_range_max: number | null
          sell_range_min: number | null
          status: string
          tier: string
          vehicle_summary: string
        }
        Insert: {
          admin_buy_range_max?: number | null
          admin_buy_range_min?: number | null
          admin_note?: string | null
          admin_response?: string | null
          buy_range_max?: number | null
          buy_range_min?: number | null
          confidence: string
          created_at?: string
          dealer_name: string
          frank_response: string
          id?: string
          parsed_vehicle: Json
          photo_paths?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          sell_range_max?: number | null
          sell_range_min?: number | null
          status?: string
          tier: string
          vehicle_summary: string
        }
        Update: {
          admin_buy_range_max?: number | null
          admin_buy_range_min?: number | null
          admin_note?: string | null
          admin_response?: string | null
          buy_range_max?: number | null
          buy_range_min?: number | null
          confidence?: string
          created_at?: string
          dealer_name?: string
          frank_response?: string
          id?: string
          parsed_vehicle?: Json
          photo_paths?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          sell_range_max?: number | null
          sell_range_min?: number | null
          status?: string
          tier?: string
          vehicle_summary?: string
        }
        Relationships: []
      }
      vehicle_listings: {
        Row: {
          asking_price: number | null
          auction_datetime: string | null
          auction_history: Json | null
          auction_house: string | null
          drivetrain: string | null
          event_id: string | null
          excluded_keyword: string | null
          excluded_reason: string | null
          first_seen_at: string
          fuel: string | null
          highest_bid: number | null
          id: string
          is_dealer_grade: boolean | null
          km: number | null
          last_auction_date: string | null
          last_seen_at: string
          listed_date_raw: string | null
          listing_id: string
          listing_url: string | null
          location: string | null
          lot_id: string | null
          make: string
          model: string
          pass_count: number
          relist_count: number
          reserve: number | null
          seller_confidence: string | null
          seller_reasons: string[] | null
          seller_type: string
          source: string
          source_class: string
          status: string
          transmission: string | null
          updated_at: string
          variant_family: string | null
          variant_raw: string | null
          visible_to_dealers: boolean
          year: number
        }
        Insert: {
          asking_price?: number | null
          auction_datetime?: string | null
          auction_history?: Json | null
          auction_house?: string | null
          drivetrain?: string | null
          event_id?: string | null
          excluded_keyword?: string | null
          excluded_reason?: string | null
          first_seen_at?: string
          fuel?: string | null
          highest_bid?: number | null
          id?: string
          is_dealer_grade?: boolean | null
          km?: number | null
          last_auction_date?: string | null
          last_seen_at?: string
          listed_date_raw?: string | null
          listing_id: string
          listing_url?: string | null
          location?: string | null
          lot_id?: string | null
          make: string
          model: string
          pass_count?: number
          relist_count?: number
          reserve?: number | null
          seller_confidence?: string | null
          seller_reasons?: string[] | null
          seller_type?: string
          source?: string
          source_class?: string
          status?: string
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          variant_raw?: string | null
          visible_to_dealers?: boolean
          year: number
        }
        Update: {
          asking_price?: number | null
          auction_datetime?: string | null
          auction_history?: Json | null
          auction_house?: string | null
          drivetrain?: string | null
          event_id?: string | null
          excluded_keyword?: string | null
          excluded_reason?: string | null
          first_seen_at?: string
          fuel?: string | null
          highest_bid?: number | null
          id?: string
          is_dealer_grade?: boolean | null
          km?: number | null
          last_auction_date?: string | null
          last_seen_at?: string
          listed_date_raw?: string | null
          listing_id?: string
          listing_url?: string | null
          location?: string | null
          lot_id?: string | null
          make?: string
          model?: string
          pass_count?: number
          relist_count?: number
          reserve?: number | null
          seller_confidence?: string | null
          seller_reasons?: string[] | null
          seller_type?: string
          source?: string
          source_class?: string
          status?: string
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          variant_raw?: string | null
          visible_to_dealers?: boolean
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_dealer_grade:
        | {
            Args: {
              p_asking_price: number
              p_excluded_keyword: string
              p_excluded_reason: string
              p_reserve: number
              p_year: number
            }
            Returns: boolean
          }
        | {
            Args: {
              p_asking_price: number
              p_excluded_keyword: string
              p_excluded_reason: string
              p_price_max?: number
              p_price_min?: number
              p_reserve: number
              p_year: number
            }
            Returns: boolean
          }
        | {
            Args: {
              p_asking_price: number
              p_excluded_keyword: string
              p_excluded_reason: string
              p_price_max?: number
              p_price_min?: number
              p_reserve: number
              p_source_class?: string
              p_year: number
            }
            Returns: boolean
          }
      derive_clearance_events: {
        Args: { p_stale_hours?: number }
        Returns: {
          events_created: number
          listings_processed: number
        }[]
      }
      detect_geo_heat_alerts: {
        Args: {
          p_asof?: string
          p_drop_threshold?: number
          p_min_sample_7d?: number
        }
        Returns: {
          alert_tier: string
          confidence: string
          dealer_share_7d: number
          make: string
          metric_type: string
          model: string
          pct_change: number
          region_id: string
          sample_7d: number
          value_28d: number
          value_7d: number
          variant_bucket: string
        }[]
      }
      generate_geo_heat_alerts: {
        Args: {
          p_asof?: string
          p_drop_threshold?: number
          p_min_sample_7d?: number
        }
        Returns: {
          alerts_created: number
          alerts_updated: number
        }[]
      }
      get_dealer_profile: {
        Args: { _user_id: string }
        Returns: {
          dealer_name: string
          org_id: string
          region_id: string
        }[]
      }
      get_dealer_profile_by_user: {
        Args: { _user_id: string }
        Returns: {
          dealer_name: string
          dealer_profile_id: string
          org_id: string
          region_id: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      km_to_band: {
        Args: { p_km: number }
        Returns: {
          km_band_max: number
          km_band_min: number
        }[]
      }
      location_to_region: { Args: { p_location: string }; Returns: string }
      materialize_fingerprint_outcomes: {
        Args: { p_asof?: string }
        Returns: {
          records_upserted: number
          regions_processed: number
        }[]
      }
      rollup_geo_model_metrics_daily: {
        Args: { p_day?: string }
        Returns: {
          records_upserted: number
          regions_updated: number
        }[]
      }
      seller_weight: { Args: { p_seller_type: string }; Returns: number }
      year_to_band: {
        Args: { p_year: number }
        Returns: {
          year_max: number
          year_min: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "dealer" | "internal"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "dealer", "internal"],
    },
  },
} as const
