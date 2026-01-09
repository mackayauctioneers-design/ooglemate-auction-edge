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
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_audit_log: {
        Row: {
          cron_name: string
          error: string | null
          id: string
          result: Json | null
          run_at: string
          run_date: string
          success: boolean
        }
        Insert: {
          cron_name: string
          error?: string | null
          id?: string
          result?: Json | null
          run_at?: string
          run_date?: string
          success?: boolean
        }
        Update: {
          cron_name?: string
          error?: string | null
          id?: string
          result?: Json | null
          run_at?: string
          run_date?: string
          success?: boolean
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
      dealer_groups: {
        Row: {
          created_at: string
          discovery_url: string | null
          group_name: string
          id: string
          notes: string | null
          platform_type: string
          region_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discovery_url?: string | null
          group_name: string
          id?: string
          notes?: string | null
          platform_type?: string
          region_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discovery_url?: string | null
          group_name?: string
          id?: string
          notes?: string | null
          platform_type?: string
          region_id?: string
          updated_at?: string
        }
        Relationships: []
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dealer_name: string
          id?: string
          org_id?: string | null
          region_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dealer_name?: string
          id?: string
          org_id?: string | null
          region_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      dealer_traps: {
        Row: {
          anchor_trap: boolean
          auto_disabled_at: string | null
          auto_disabled_reason: string | null
          consecutive_failures: number
          created_at: string
          dealer_group: string | null
          dealer_name: string
          enabled: boolean
          group_id: string | null
          id: string
          inventory_url: string
          last_crawl_at: string | null
          last_fail_at: string | null
          last_fail_reason: string | null
          last_preflight_markers: Json | null
          last_validated_at: string | null
          last_vehicle_count: number | null
          parser_confidence: string | null
          parser_mode: string
          postcode: string | null
          preflight_checked_at: string | null
          preflight_reason: string | null
          preflight_status: string | null
          priority: string
          region_id: string
          state: string | null
          suburb: string | null
          successful_validation_runs: number
          trap_slug: string
          updated_at: string
          validation_notes: string | null
          validation_runs: number
          validation_status: string
        }
        Insert: {
          anchor_trap?: boolean
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number
          created_at?: string
          dealer_group?: string | null
          dealer_name: string
          enabled?: boolean
          group_id?: string | null
          id?: string
          inventory_url: string
          last_crawl_at?: string | null
          last_fail_at?: string | null
          last_fail_reason?: string | null
          last_preflight_markers?: Json | null
          last_validated_at?: string | null
          last_vehicle_count?: number | null
          parser_confidence?: string | null
          parser_mode: string
          postcode?: string | null
          preflight_checked_at?: string | null
          preflight_reason?: string | null
          preflight_status?: string | null
          priority?: string
          region_id?: string
          state?: string | null
          suburb?: string | null
          successful_validation_runs?: number
          trap_slug: string
          updated_at?: string
          validation_notes?: string | null
          validation_runs?: number
          validation_status?: string
        }
        Update: {
          anchor_trap?: boolean
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number
          created_at?: string
          dealer_group?: string | null
          dealer_name?: string
          enabled?: boolean
          group_id?: string | null
          id?: string
          inventory_url?: string
          last_crawl_at?: string | null
          last_fail_at?: string | null
          last_fail_reason?: string | null
          last_preflight_markers?: Json | null
          last_validated_at?: string | null
          last_vehicle_count?: number | null
          parser_confidence?: string | null
          parser_mode?: string
          postcode?: string | null
          preflight_checked_at?: string | null
          preflight_reason?: string | null
          preflight_status?: string | null
          priority?: string
          region_id?: string
          state?: string | null
          suburb?: string | null
          successful_validation_runs?: number
          trap_slug?: string
          updated_at?: string
          validation_notes?: string | null
          validation_runs?: number
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_rooftops_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "dealer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      feeding_mode_reports: {
        Row: {
          created_at: string
          id: string
          report_date: string
          report_json: Json
        }
        Insert: {
          created_at?: string
          id?: string
          report_date: string
          report_json: Json
        }
        Update: {
          created_at?: string
          id?: string
          report_date?: string
          report_json?: Json
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
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      trap_crawl_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          max_attempts: number
          result: Json | null
          run_type: string
          started_at: string | null
          status: string
          trap_slug: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          result?: Json | null
          run_type: string
          started_at?: string | null
          status?: string
          trap_slug: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          result?: Json | null
          run_type?: string
          started_at?: string | null
          status?: string
          trap_slug?: string
        }
        Relationships: []
      }
      trap_crawl_runs: {
        Row: {
          created_at: string
          dealer_name: string
          drop_reasons: Json | null
          error: string | null
          id: string
          parser_mode: string
          run_completed_at: string | null
          run_date: string
          run_started_at: string
          trap_slug: string
          vehicles_dropped: number
          vehicles_found: number
          vehicles_ingested: number
        }
        Insert: {
          created_at?: string
          dealer_name: string
          drop_reasons?: Json | null
          error?: string | null
          id?: string
          parser_mode: string
          run_completed_at?: string | null
          run_date?: string
          run_started_at?: string
          trap_slug: string
          vehicles_dropped?: number
          vehicles_found?: number
          vehicles_ingested?: number
        }
        Update: {
          created_at?: string
          dealer_name?: string
          drop_reasons?: Json | null
          error?: string | null
          id?: string
          parser_mode?: string
          run_completed_at?: string | null
          run_date?: string
          run_started_at?: string
          trap_slug?: string
          vehicles_dropped?: number
          vehicles_found?: number
          vehicles_ingested?: number
        }
        Relationships: []
      }
      trap_deal_alerts: {
        Row: {
          alert_date: string
          asking_price: number | null
          created_at: string
          deal_label: string
          delta_pct: number | null
          fingerprint_price: number | null
          fingerprint_sample: number | null
          id: string
          listing_id: string
          make: string | null
          model: string | null
          slack_sent_at: string | null
          trap_slug: string | null
          year: number | null
        }
        Insert: {
          alert_date?: string
          asking_price?: number | null
          created_at?: string
          deal_label: string
          delta_pct?: number | null
          fingerprint_price?: number | null
          fingerprint_sample?: number | null
          id?: string
          listing_id: string
          make?: string | null
          model?: string | null
          slack_sent_at?: string | null
          trap_slug?: string | null
          year?: number | null
        }
        Update: {
          alert_date?: string
          asking_price?: number | null
          created_at?: string
          deal_label?: string
          delta_pct?: number | null
          fingerprint_price?: number | null
          fingerprint_sample?: number | null
          id?: string
          listing_id?: string
          make?: string | null
          model?: string | null
          slack_sent_at?: string | null
          trap_slug?: string | null
          year?: number | null
        }
        Relationships: []
      }
      trap_health_alerts: {
        Row: {
          alert_date: string
          alert_type: string
          id: string
          payload: Json
          sent_at: string
          trap_slug: string
        }
        Insert: {
          alert_date?: string
          alert_type: string
          id?: string
          payload?: Json
          sent_at?: string
          trap_slug: string
        }
        Update: {
          alert_date?: string
          alert_type?: string
          id?: string
          payload?: Json
          sent_at?: string
          trap_slug?: string
        }
        Relationships: []
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
      user_watchlist: {
        Row: {
          created_at: string
          id: string
          is_pinned: boolean | null
          is_watching: boolean | null
          listing_id: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          is_watching?: boolean | null
          listing_id: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          is_watching?: boolean | null
          listing_id?: string
          notes?: string | null
          updated_at?: string
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
      dealer_crawl_jobs: {
        Row: {
          attempts: number | null
          created_at: string | null
          error: string | null
          finished_at: string | null
          id: string | null
          max_attempts: number | null
          result: Json | null
          run_type: string | null
          started_at: string | null
          status: string | null
          trap_slug: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          max_attempts?: number | null
          result?: Json | null
          run_type?: string | null
          started_at?: string | null
          status?: string | null
          trap_slug?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          max_attempts?: number | null
          result?: Json | null
          run_type?: string | null
          started_at?: string | null
          status?: string | null
          trap_slug?: string | null
        }
        Relationships: []
      }
      dealer_crawl_runs: {
        Row: {
          created_at: string | null
          dealer_name: string | null
          drop_reasons: Json | null
          error: string | null
          id: string | null
          parser_mode: string | null
          run_completed_at: string | null
          run_date: string | null
          run_started_at: string | null
          trap_slug: string | null
          vehicles_dropped: number | null
          vehicles_found: number | null
          vehicles_ingested: number | null
        }
        Insert: {
          created_at?: string | null
          dealer_name?: string | null
          drop_reasons?: Json | null
          error?: string | null
          id?: string | null
          parser_mode?: string | null
          run_completed_at?: string | null
          run_date?: string | null
          run_started_at?: string | null
          trap_slug?: string | null
          vehicles_dropped?: number | null
          vehicles_found?: number | null
          vehicles_ingested?: number | null
        }
        Update: {
          created_at?: string | null
          dealer_name?: string | null
          drop_reasons?: Json | null
          error?: string | null
          id?: string | null
          parser_mode?: string | null
          run_completed_at?: string | null
          run_date?: string | null
          run_started_at?: string | null
          trap_slug?: string | null
          vehicles_dropped?: number | null
          vehicles_found?: number | null
          vehicles_ingested?: number | null
        }
        Relationships: []
      }
      dealer_rooftops: {
        Row: {
          anchor_trap: boolean | null
          auto_disabled_at: string | null
          auto_disabled_reason: string | null
          consecutive_failures: number | null
          created_at: string | null
          dealer_group: string | null
          dealer_name: string | null
          enabled: boolean | null
          group_id: string | null
          id: string | null
          inventory_url: string | null
          last_crawl_at: string | null
          last_fail_at: string | null
          last_fail_reason: string | null
          last_preflight_markers: Json | null
          last_validated_at: string | null
          last_vehicle_count: number | null
          parser_confidence: string | null
          parser_mode: string | null
          postcode: string | null
          priority: string | null
          region_id: string | null
          state: string | null
          suburb: string | null
          successful_validation_runs: number | null
          trap_slug: string | null
          updated_at: string | null
          validation_notes: string | null
          validation_runs: number | null
          validation_status: string | null
        }
        Insert: {
          anchor_trap?: boolean | null
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number | null
          created_at?: string | null
          dealer_group?: string | null
          dealer_name?: string | null
          enabled?: boolean | null
          group_id?: string | null
          id?: string | null
          inventory_url?: string | null
          last_crawl_at?: string | null
          last_fail_at?: string | null
          last_fail_reason?: string | null
          last_preflight_markers?: Json | null
          last_validated_at?: string | null
          last_vehicle_count?: number | null
          parser_confidence?: string | null
          parser_mode?: string | null
          postcode?: string | null
          priority?: string | null
          region_id?: string | null
          state?: string | null
          suburb?: string | null
          successful_validation_runs?: number | null
          trap_slug?: string | null
          updated_at?: string | null
          validation_notes?: string | null
          validation_runs?: number | null
          validation_status?: string | null
        }
        Update: {
          anchor_trap?: boolean | null
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number | null
          created_at?: string | null
          dealer_group?: string | null
          dealer_name?: string | null
          enabled?: boolean | null
          group_id?: string | null
          id?: string | null
          inventory_url?: string | null
          last_crawl_at?: string | null
          last_fail_at?: string | null
          last_fail_reason?: string | null
          last_preflight_markers?: Json | null
          last_validated_at?: string | null
          last_vehicle_count?: number | null
          parser_confidence?: string | null
          parser_mode?: string | null
          postcode?: string | null
          priority?: string | null
          region_id?: string | null
          state?: string | null
          suburb?: string | null
          successful_validation_runs?: number | null
          trap_slug?: string | null
          updated_at?: string | null
          validation_notes?: string | null
          validation_runs?: number | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_rooftops_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "dealer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      fingerprint_outcomes_latest: {
        Row: {
          asof_date: string | null
          avg_days_to_clear: number | null
          avg_price: number | null
          cleared_total: number | null
          created_at: string | null
          example_listing_id: string | null
          fuel: string | null
          id: string | null
          km_band_max: number | null
          km_band_min: number | null
          listing_total: number | null
          make: string | null
          max_days_to_clear: number | null
          max_price: number | null
          min_days_to_clear: number | null
          min_price: number | null
          model: string | null
          passed_in_total: number | null
          region_id: string | null
          relisted_total: number | null
          transmission: string | null
          updated_at: string | null
          variant_family: string | null
          year_max: number | null
          year_min: number | null
        }
        Relationships: []
      }
      stale_dealer_grade: {
        Row: {
          first_seen_at: string | null
          hours_since_seen: number | null
          id: string | null
          is_dealer_grade: boolean | null
          last_seen_at: string | null
          listing_id: string | null
          make: string | null
          model: string | null
          source: string | null
          status: string | null
          year: number | null
        }
        Insert: {
          first_seen_at?: string | null
          hours_since_seen?: never
          id?: string | null
          is_dealer_grade?: boolean | null
          last_seen_at?: string | null
          listing_id?: string | null
          make?: string | null
          model?: string | null
          source?: string | null
          status?: string | null
          year?: number | null
        }
        Update: {
          first_seen_at?: string | null
          hours_since_seen?: never
          id?: string | null
          is_dealer_grade?: boolean | null
          last_seen_at?: string | null
          listing_id?: string | null
          make?: string | null
          model?: string | null
          source?: string | null
          status?: string | null
          year?: number | null
        }
        Relationships: []
      }
      trap_deals: {
        Row: {
          asking_price: number | null
          days_on_market: number | null
          deal_label: string | null
          delta_dollars: number | null
          delta_pct: number | null
          fingerprint_price: number | null
          fingerprint_sample: number | null
          fingerprint_ttd: number | null
          first_price: number | null
          first_seen_at: string | null
          id: string | null
          km: number | null
          last_price_change_at: string | null
          listing_id: string | null
          listing_url: string | null
          location: string | null
          make: string | null
          model: string | null
          no_benchmark: boolean | null
          price_change_count: number | null
          region_id: string | null
          source: string | null
          status: string | null
          trap_slug: string | null
          variant_family: string | null
          year: number | null
        }
        Relationships: []
      }
      trap_deals_90_plus: {
        Row: {
          asking_price: number | null
          days_on_market: number | null
          deal_label: string | null
          delta_dollars: number | null
          delta_pct: number | null
          fingerprint_price: number | null
          fingerprint_sample: number | null
          fingerprint_ttd: number | null
          first_price: number | null
          first_seen_at: string | null
          id: string | null
          km: number | null
          last_price_change_at: string | null
          listing_id: string | null
          listing_url: string | null
          location: string | null
          make: string | null
          model: string | null
          no_benchmark: boolean | null
          price_change_count: number | null
          region_id: string | null
          source: string | null
          status: string | null
          trap_slug: string | null
          variant_family: string | null
          year: number | null
        }
        Relationships: []
      }
      trap_inventory_current: {
        Row: {
          asking_price: number | null
          days_on_market: number | null
          first_price: number | null
          first_seen_at: string | null
          id: string | null
          km: number | null
          km_band_max: number | null
          km_band_min: number | null
          last_price_change_at: string | null
          listing_id: string | null
          listing_url: string | null
          location: string | null
          make: string | null
          model: string | null
          price_change_count: number | null
          region_id: string | null
          source: string | null
          source_class: string | null
          status: string | null
          trap_slug: string | null
          variant_family: string | null
          year: number | null
          year_band_max: number | null
          year_band_min: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_next_job: {
        Args: never
        Returns: {
          attempts: number
          job_id: string
          max_attempts: number
          run_type: string
          trap_slug: string
        }[]
      }
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
      get_clearance_today: {
        Args: never
        Returns: {
          count: number
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
      get_fingerprints_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      get_job_queue_stats: {
        Args: never
        Returns: {
          completed: number
          failed: number
          pending: number
          processing: number
        }[]
      }
      get_nsw_crawl_today: {
        Args: never
        Returns: {
          crawl_runs: number
          vehicles_dropped: number
          vehicles_found: number
          vehicles_ingested: number
        }[]
      }
      get_nsw_trap_stats: {
        Args: never
        Returns: {
          enabled_count: number
          region_id: string
          total_count: number
        }[]
      }
      get_top_drop_reasons: {
        Args: never
        Returns: {
          count: number
          drop_reason: string
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
      nsw_region_bucket:
        | "NSW_SYDNEY_METRO"
        | "NSW_CENTRAL_COAST"
        | "NSW_HUNTER_NEWCASTLE"
        | "NSW_REGIONAL"
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
      nsw_region_bucket: [
        "NSW_SYDNEY_METRO",
        "NSW_CENTRAL_COAST",
        "NSW_HUNTER_NEWCASTLE",
        "NSW_REGIONAL",
      ],
    },
  },
} as const
