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
      apify_runs_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          dataset_id: string | null
          id: string
          input: Json
          items_fetched: number | null
          items_upserted: number | null
          last_error: string | null
          lock_token: string | null
          locked_until: string | null
          run_id: string | null
          source: string
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          dataset_id?: string | null
          id?: string
          input: Json
          items_fetched?: number | null
          items_upserted?: number | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          run_id?: string | null
          source?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          dataset_id?: string | null
          id?: string
          input?: Json
          items_fetched?: number | null
          items_upserted?: number | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          run_id?: string | null
          source?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      auction_schedule_runs: {
        Row: {
          created: number | null
          created_at: string
          dropped: number | null
          error: string | null
          id: string
          lots_found: number | null
          reason: string | null
          run_at: string
          run_date: string
          source_key: string
          status: string
          updated: number | null
        }
        Insert: {
          created?: number | null
          created_at?: string
          dropped?: number | null
          error?: string | null
          id?: string
          lots_found?: number | null
          reason?: string | null
          run_at?: string
          run_date?: string
          source_key: string
          status: string
          updated?: number | null
        }
        Update: {
          created?: number | null
          created_at?: string
          dropped?: number | null
          error?: string | null
          id?: string
          lots_found?: number | null
          reason?: string | null
          run_at?: string
          run_date?: string
          source_key?: string
          status?: string
          updated?: number | null
        }
        Relationships: []
      }
      auction_source_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string | null
          meta: Json | null
          source_key: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          meta?: Json | null
          source_key: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          meta?: Json | null
          source_key?: string
        }
        Relationships: []
      }
      auction_sources: {
        Row: {
          auto_disabled_at: string | null
          auto_disabled_reason: string | null
          consecutive_failures: number | null
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          last_crawl_fail_at: string | null
          last_error: string | null
          last_lots_found: number | null
          last_scheduled_run_at: string | null
          last_success_at: string | null
          list_url: string
          notes: string | null
          parser_profile: string | null
          platform: string
          preflight_checked_at: string | null
          preflight_markers: Json | null
          preflight_reason: string | null
          preflight_status: string | null
          region_hint: string
          schedule_days: string[]
          schedule_enabled: boolean
          schedule_min_interval_minutes: number
          schedule_pause_reason: string | null
          schedule_paused: boolean
          schedule_time_local: string
          schedule_tz: string
          source_key: string
          successful_validation_runs: number | null
          updated_at: string
          validation_runs: number | null
          validation_status: string | null
        }
        Insert: {
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number | null
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          last_crawl_fail_at?: string | null
          last_error?: string | null
          last_lots_found?: number | null
          last_scheduled_run_at?: string | null
          last_success_at?: string | null
          list_url: string
          notes?: string | null
          parser_profile?: string | null
          platform?: string
          preflight_checked_at?: string | null
          preflight_markers?: Json | null
          preflight_reason?: string | null
          preflight_status?: string | null
          region_hint?: string
          schedule_days?: string[]
          schedule_enabled?: boolean
          schedule_min_interval_minutes?: number
          schedule_pause_reason?: string | null
          schedule_paused?: boolean
          schedule_time_local?: string
          schedule_tz?: string
          source_key: string
          successful_validation_runs?: number | null
          updated_at?: string
          validation_runs?: number | null
          validation_status?: string | null
        }
        Update: {
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          consecutive_failures?: number | null
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          last_crawl_fail_at?: string | null
          last_error?: string | null
          last_lots_found?: number | null
          last_scheduled_run_at?: string | null
          last_success_at?: string | null
          list_url?: string
          notes?: string | null
          parser_profile?: string | null
          platform?: string
          preflight_checked_at?: string | null
          preflight_markers?: Json | null
          preflight_reason?: string | null
          preflight_status?: string | null
          region_hint?: string
          schedule_days?: string[]
          schedule_enabled?: boolean
          schedule_min_interval_minutes?: number
          schedule_pause_reason?: string | null
          schedule_paused?: boolean
          schedule_time_local?: string
          schedule_tz?: string
          source_key?: string
          successful_validation_runs?: number | null
          updated_at?: string
          validation_runs?: number | null
          validation_status?: string | null
        }
        Relationships: []
      }
      autotrader_crawl_cursor: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_listings_found: number | null
          last_page_crawled: number
          last_run_at: string | null
          make: string
          state: string
          status: string
          total_pages_estimated: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_listings_found?: number | null
          last_page_crawled?: number
          last_run_at?: string | null
          make: string
          state: string
          status?: string
          total_pages_estimated?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_listings_found?: number | null
          last_page_crawled?: number
          last_run_at?: string | null
          make?: string
          state?: string
          status?: string
          total_pages_estimated?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      autotrader_raw_payloads: {
        Row: {
          first_seen_at: string
          id: string
          last_seen_at: string
          payload: Json
          price_at_first_seen: number | null
          price_at_last_seen: number | null
          source_listing_id: string
          times_seen: number
        }
        Insert: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload: Json
          price_at_first_seen?: number | null
          price_at_last_seen?: number | null
          source_listing_id: string
          times_seen?: number
        }
        Update: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload?: Json
          price_at_first_seen?: number | null
          price_at_last_seen?: number | null
          source_listing_id?: string
          times_seen?: number
        }
        Relationships: []
      }
      bob_chat_context_log: {
        Row: {
          created_at: string | null
          dealer_id: string | null
          filters: Json | null
          id: string
          page_summary: Json | null
          route: string | null
          selected_auction_event_id: string | null
          selected_lot_id: string | null
        }
        Insert: {
          created_at?: string | null
          dealer_id?: string | null
          filters?: Json | null
          id?: string
          page_summary?: Json | null
          route?: string | null
          selected_auction_event_id?: string | null
          selected_lot_id?: string | null
        }
        Update: {
          created_at?: string | null
          dealer_id?: string | null
          filters?: Json | null
          id?: string
          page_summary?: Json | null
          route?: string | null
          selected_auction_event_id?: string | null
          selected_lot_id?: string | null
        }
        Relationships: []
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
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
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
      cron_heartbeat: {
        Row: {
          cron_name: string
          last_ok: boolean
          last_seen_at: string
          note: string | null
        }
        Insert: {
          cron_name: string
          last_ok?: boolean
          last_seen_at?: string
          note?: string | null
        }
        Update: {
          cron_name?: string
          last_ok?: boolean
          last_seen_at?: string
          note?: string | null
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
      dealer_match_alerts: {
        Row: {
          alert_date: string
          asking_price: number | null
          benchmark_price: number | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string | null
          dealer_id: string
          delta_dollars: number | null
          delta_pct: number | null
          id: string
          km: number | null
          listing_url: string | null
          listing_uuid: string
          make: string | null
          match_score: number | null
          match_type: string
          model: string | null
          region_id: string | null
          source: string | null
          source_class: string | null
          spec_id: string
          status: string | null
          variant_used: string | null
          year: number | null
        }
        Insert: {
          alert_date?: string
          asking_price?: number | null
          benchmark_price?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          dealer_id: string
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          km?: number | null
          listing_url?: string | null
          listing_uuid: string
          make?: string | null
          match_score?: number | null
          match_type: string
          model?: string | null
          region_id?: string | null
          source?: string | null
          source_class?: string | null
          spec_id: string
          status?: string | null
          variant_used?: string | null
          year?: number | null
        }
        Update: {
          alert_date?: string
          asking_price?: number | null
          benchmark_price?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          dealer_id?: string
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          km?: number | null
          listing_url?: string | null
          listing_uuid?: string
          make?: string | null
          match_score?: number | null
          match_type?: string
          model?: string | null
          region_id?: string | null
          source?: string | null
          source_class?: string | null
          spec_id?: string
          status?: string | null
          variant_used?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_match_alerts_spec_id_fkey"
            columns: ["spec_id"]
            isOneToOne: false
            referencedRelation: "dealer_match_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_match_specs: {
        Row: {
          created_at: string | null
          dealer_id: string
          dealer_name: string
          drivetrain: string | null
          enabled: boolean | null
          fuel: string | null
          id: string
          km_max: number | null
          make: string
          min_under_pct: number | null
          model: string
          note: string | null
          region_id: string | null
          region_scope: string | null
          require_benchmark: boolean | null
          transmission: string | null
          updated_at: string | null
          variant_family: string | null
          year_max: number | null
          year_min: number | null
        }
        Insert: {
          created_at?: string | null
          dealer_id: string
          dealer_name: string
          drivetrain?: string | null
          enabled?: boolean | null
          fuel?: string | null
          id?: string
          km_max?: number | null
          make: string
          min_under_pct?: number | null
          model: string
          note?: string | null
          region_id?: string | null
          region_scope?: string | null
          require_benchmark?: boolean | null
          transmission?: string | null
          updated_at?: string | null
          variant_family?: string | null
          year_max?: number | null
          year_min?: number | null
        }
        Update: {
          created_at?: string | null
          dealer_id?: string
          dealer_name?: string
          drivetrain?: string | null
          enabled?: boolean | null
          fuel?: string | null
          id?: string
          km_max?: number | null
          make?: string
          min_under_pct?: number | null
          model?: string
          note?: string | null
          region_id?: string | null
          region_scope?: string | null
          require_benchmark?: boolean | null
          transmission?: string | null
          updated_at?: string | null
          variant_family?: string | null
          year_max?: number | null
          year_min?: number | null
        }
        Relationships: []
      }
      dealer_notification_settings: {
        Row: {
          created_at: string | null
          dealer_id: string
          email: string | null
          notify_buy: boolean | null
          notify_watch: boolean | null
          phone: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          slack_webhook_url: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          dealer_id: string
          email?: string | null
          notify_buy?: boolean | null
          notify_watch?: boolean | null
          phone?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          slack_webhook_url?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          dealer_id?: string
          email?: string | null
          notify_buy?: boolean | null
          notify_watch?: boolean | null
          phone?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          slack_webhook_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dealer_outcomes: {
        Row: {
          confidence: number | null
          created_at: string
          days_to_exit: number | null
          dealer_id: string
          dealer_name: string | null
          drivetrain: string | null
          fingerprint: string
          fuel: string | null
          gross_profit: number | null
          id: string
          km_band: string | null
          make: string
          model: string
          purchase_price: number | null
          region_id: string | null
          sale_price: number | null
          sold_date: string | null
          source_channel: string | null
          source_row_id: string | null
          transmission: string | null
          updated_at: string
          variant_confidence: number | null
          variant_family: string | null
          year: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          days_to_exit?: number | null
          dealer_id: string
          dealer_name?: string | null
          drivetrain?: string | null
          fingerprint: string
          fuel?: string | null
          gross_profit?: number | null
          id?: string
          km_band?: string | null
          make: string
          model: string
          purchase_price?: number | null
          region_id?: string | null
          sale_price?: number | null
          sold_date?: string | null
          source_channel?: string | null
          source_row_id?: string | null
          transmission?: string | null
          updated_at?: string
          variant_confidence?: number | null
          variant_family?: string | null
          year: number
        }
        Update: {
          confidence?: number | null
          created_at?: string
          days_to_exit?: number | null
          dealer_id?: string
          dealer_name?: string | null
          drivetrain?: string | null
          fingerprint?: string
          fuel?: string | null
          gross_profit?: number | null
          id?: string
          km_band?: string | null
          make?: string
          model?: string
          purchase_price?: number | null
          region_id?: string | null
          sale_price?: number | null
          sold_date?: string | null
          source_channel?: string | null
          source_row_id?: string | null
          transmission?: string | null
          updated_at?: string
          variant_confidence?: number | null
          variant_family?: string | null
          year?: number
        }
        Relationships: []
      }
      dealer_profile: {
        Row: {
          created_at: string | null
          dealer_id: string
          exclude_salvage: boolean | null
          exclude_segments: Json | null
          exclude_stat_writeoff: boolean | null
          exclude_wovr: boolean | null
          geo_preferences: Json | null
          output_style: Json | null
          preferred_segments: Json | null
          scoring_thresholds: Json | null
          updated_at: string | null
          year_max: number | null
          year_min: number | null
        }
        Insert: {
          created_at?: string | null
          dealer_id: string
          exclude_salvage?: boolean | null
          exclude_segments?: Json | null
          exclude_stat_writeoff?: boolean | null
          exclude_wovr?: boolean | null
          geo_preferences?: Json | null
          output_style?: Json | null
          preferred_segments?: Json | null
          scoring_thresholds?: Json | null
          updated_at?: string | null
          year_max?: number | null
          year_min?: number | null
        }
        Update: {
          created_at?: string | null
          dealer_id?: string
          exclude_salvage?: boolean | null
          exclude_segments?: Json | null
          exclude_stat_writeoff?: boolean | null
          exclude_wovr?: boolean | null
          geo_preferences?: Json | null
          output_style?: Json | null
          preferred_segments?: Json | null
          scoring_thresholds?: Json | null
          updated_at?: string | null
          year_max?: number | null
          year_min?: number | null
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
      dealer_sales: {
        Row: {
          buy_price: number | null
          cab_type: string | null
          created_at: string | null
          cylinders: number | null
          data_source: string
          dealer_id: string
          dealer_name: string | null
          engine_code: string | null
          engine_litres: number | null
          fingerprint: string | null
          fingerprint_confidence: number | null
          fingerprint_version: number | null
          gross_profit: number | null
          id: string
          import_batch_id: string | null
          km: number | null
          make: string
          model: string
          region_id: string | null
          sell_price: number | null
          sold_date: string
          source_channel: string | null
          state: string | null
          updated_at: string | null
          variant_raw: string | null
          year: number
        }
        Insert: {
          buy_price?: number | null
          cab_type?: string | null
          created_at?: string | null
          cylinders?: number | null
          data_source?: string
          dealer_id: string
          dealer_name?: string | null
          engine_code?: string | null
          engine_litres?: number | null
          fingerprint?: string | null
          fingerprint_confidence?: number | null
          fingerprint_version?: number | null
          gross_profit?: number | null
          id?: string
          import_batch_id?: string | null
          km?: number | null
          make: string
          model: string
          region_id?: string | null
          sell_price?: number | null
          sold_date: string
          source_channel?: string | null
          state?: string | null
          updated_at?: string | null
          variant_raw?: string | null
          year: number
        }
        Update: {
          buy_price?: number | null
          cab_type?: string | null
          created_at?: string | null
          cylinders?: number | null
          data_source?: string
          dealer_id?: string
          dealer_name?: string | null
          engine_code?: string | null
          engine_litres?: number | null
          fingerprint?: string | null
          fingerprint_confidence?: number | null
          fingerprint_version?: number | null
          gross_profit?: number | null
          id?: string
          import_batch_id?: string | null
          km?: number | null
          make?: string
          model?: string
          region_id?: string | null
          sell_price?: number | null
          sold_date?: string
          source_channel?: string | null
          state?: string | null
          updated_at?: string | null
          variant_raw?: string | null
          year?: number
        }
        Relationships: []
      }
      dealer_spec_matches: {
        Row: {
          asking_price: number | null
          benchmark_price: number | null
          created_at: string | null
          deal_label: string | null
          dealer_spec_id: string
          delta_pct: number | null
          id: string
          km: number | null
          listing_url: string | null
          listing_uuid: string
          make: string | null
          match_reason: Json | null
          match_score: number | null
          matched_at: string | null
          model: string | null
          region_id: string | null
          sent_to_slack_at: string | null
          source_class: string | null
          variant_used: string | null
          watch_status: string | null
          year: number | null
        }
        Insert: {
          asking_price?: number | null
          benchmark_price?: number | null
          created_at?: string | null
          deal_label?: string | null
          dealer_spec_id: string
          delta_pct?: number | null
          id?: string
          km?: number | null
          listing_url?: string | null
          listing_uuid: string
          make?: string | null
          match_reason?: Json | null
          match_score?: number | null
          matched_at?: string | null
          model?: string | null
          region_id?: string | null
          sent_to_slack_at?: string | null
          source_class?: string | null
          variant_used?: string | null
          watch_status?: string | null
          year?: number | null
        }
        Update: {
          asking_price?: number | null
          benchmark_price?: number | null
          created_at?: string | null
          deal_label?: string | null
          dealer_spec_id?: string
          delta_pct?: number | null
          id?: string
          km?: number | null
          listing_url?: string | null
          listing_uuid?: string
          make?: string | null
          match_reason?: Json | null
          match_score?: number | null
          matched_at?: string | null
          model?: string | null
          region_id?: string | null
          sent_to_slack_at?: string | null
          source_class?: string | null
          variant_used?: string | null
          watch_status?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_spec_matches_dealer_spec_id_fkey"
            columns: ["dealer_spec_id"]
            isOneToOne: false
            referencedRelation: "dealer_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_spec_matches_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_specs: {
        Row: {
          allow_no_benchmark: boolean | null
          auto_buy_window: boolean | null
          created_at: string | null
          dealer_id: string
          dealer_name: string
          deleted_at: string | null
          drive_allow: string[] | null
          enabled: boolean | null
          exploration_mode: boolean | null
          fuel_allow: string[] | null
          hard_max_price: number | null
          id: string
          km_max: number | null
          km_min: number | null
          make: string
          min_benchmark_confidence: string | null
          model: string
          name: string
          priority: string | null
          push_watchlist: boolean | null
          region_scope: string
          slack_alerts: boolean | null
          trans_allow: string[] | null
          under_benchmark_pct: number | null
          updated_at: string | null
          va_tasks: boolean | null
          variant_family: string | null
          year_max: number | null
          year_min: number | null
        }
        Insert: {
          allow_no_benchmark?: boolean | null
          auto_buy_window?: boolean | null
          created_at?: string | null
          dealer_id: string
          dealer_name: string
          deleted_at?: string | null
          drive_allow?: string[] | null
          enabled?: boolean | null
          exploration_mode?: boolean | null
          fuel_allow?: string[] | null
          hard_max_price?: number | null
          id?: string
          km_max?: number | null
          km_min?: number | null
          make: string
          min_benchmark_confidence?: string | null
          model: string
          name: string
          priority?: string | null
          push_watchlist?: boolean | null
          region_scope?: string
          slack_alerts?: boolean | null
          trans_allow?: string[] | null
          under_benchmark_pct?: number | null
          updated_at?: string | null
          va_tasks?: boolean | null
          variant_family?: string | null
          year_max?: number | null
          year_min?: number | null
        }
        Update: {
          allow_no_benchmark?: boolean | null
          auto_buy_window?: boolean | null
          created_at?: string | null
          dealer_id?: string
          dealer_name?: string
          deleted_at?: string | null
          drive_allow?: string[] | null
          enabled?: boolean | null
          exploration_mode?: boolean | null
          fuel_allow?: string[] | null
          hard_max_price?: number | null
          id?: string
          km_max?: number | null
          km_min?: number | null
          make?: string
          min_benchmark_confidence?: string | null
          model?: string
          name?: string
          priority?: string | null
          push_watchlist?: boolean | null
          region_scope?: string
          slack_alerts?: boolean | null
          trans_allow?: string[] | null
          under_benchmark_pct?: number | null
          updated_at?: string | null
          va_tasks?: boolean | null
          variant_family?: string | null
          year_max?: number | null
          year_min?: number | null
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
          trap_mode: string
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
          trap_mode?: string
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
          trap_mode?: string
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
      fingerprint_profit_stats: {
        Row: {
          avg_days_to_exit: number | null
          avg_gross_profit: number | null
          confidence_score: number | null
          data_freshness_days: number | null
          dominant_region: string | null
          fingerprint: string
          last_sale_date: string | null
          last_sale_source: string | null
          last_updated: string
          median_days_to_exit: number | null
          median_gross_profit: number | null
          p25_gross_profit: number | null
          p75_gross_profit: number | null
          region_id: string
          sample_size: number
          win_rate: number | null
        }
        Insert: {
          avg_days_to_exit?: number | null
          avg_gross_profit?: number | null
          confidence_score?: number | null
          data_freshness_days?: number | null
          dominant_region?: string | null
          fingerprint: string
          last_sale_date?: string | null
          last_sale_source?: string | null
          last_updated?: string
          median_days_to_exit?: number | null
          median_gross_profit?: number | null
          p25_gross_profit?: number | null
          p75_gross_profit?: number | null
          region_id?: string
          sample_size?: number
          win_rate?: number | null
        }
        Update: {
          avg_days_to_exit?: number | null
          avg_gross_profit?: number | null
          confidence_score?: number | null
          data_freshness_days?: number | null
          dominant_region?: string | null
          fingerprint?: string
          last_sale_date?: string | null
          last_sale_source?: string | null
          last_updated?: string
          median_days_to_exit?: number | null
          median_gross_profit?: number | null
          p25_gross_profit?: number | null
          p75_gross_profit?: number | null
          region_id?: string
          sample_size?: number
          win_rate?: number | null
        }
        Relationships: []
      }
      franchise_dealer_candidates: {
        Row: {
          brand: string
          created_at: string
          dealer_location: string | null
          dealer_name: string
          dealer_url: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          listing_count: number | null
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand: string
          created_at?: string
          dealer_location?: string | null
          dealer_name: string
          dealer_url?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          listing_count?: number | null
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          dealer_location?: string | null
          dealer_name?: string
          dealer_url?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          listing_count?: number | null
          notes?: string | null
          status?: string
          updated_at?: string
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
      http_session_secrets: {
        Row: {
          cookie_header: string
          expires_at: string | null
          last_error: string | null
          last_status: number | null
          site: string
          updated_at: string
          user_agent: string
        }
        Insert: {
          cookie_header: string
          expires_at?: string | null
          last_error?: string | null
          last_status?: number | null
          site: string
          updated_at?: string
          user_agent: string
        }
        Update: {
          cookie_header?: string
          expires_at?: string | null
          last_error?: string | null
          last_status?: number | null
          site?: string
          updated_at?: string
          user_agent?: string
        }
        Relationships: []
      }
      hunt_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          created_at: string
          hunt_id: string
          id: string
          last_notification_error: string | null
          listing_id: string
          notification_attempts: number | null
          notification_channel: string | null
          notify_reason: string | null
          payload: Json
          sent_at: string | null
          should_notify: boolean | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          created_at?: string
          hunt_id: string
          id?: string
          last_notification_error?: string | null
          listing_id: string
          notification_attempts?: number | null
          notification_channel?: string | null
          notify_reason?: string | null
          payload: Json
          sent_at?: string | null
          should_notify?: boolean | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          created_at?: string
          hunt_id?: string
          id?: string
          last_notification_error?: string | null
          listing_id?: string
          notification_attempts?: number | null
          notification_channel?: string | null
          notify_reason?: string | null
          payload?: Json
          sent_at?: string | null
          should_notify?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_alerts_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_external_candidates: {
        Row: {
          alert_emitted: boolean | null
          asking_price: number | null
          confidence: string | null
          created_at: string | null
          decision: string | null
          dedup_key: string
          discovered_at: string | null
          expired_at: string | null
          extraction_error: string | null
          hunt_id: string
          id: string
          km: number | null
          location: string | null
          make: string | null
          match_score: number | null
          model: string | null
          raw_snippet: string | null
          scored_at: string | null
          source_name: string
          source_url: string
          title: string | null
          variant_raw: string | null
          year: number | null
        }
        Insert: {
          alert_emitted?: boolean | null
          asking_price?: number | null
          confidence?: string | null
          created_at?: string | null
          decision?: string | null
          dedup_key: string
          discovered_at?: string | null
          expired_at?: string | null
          extraction_error?: string | null
          hunt_id: string
          id?: string
          km?: number | null
          location?: string | null
          make?: string | null
          match_score?: number | null
          model?: string | null
          raw_snippet?: string | null
          scored_at?: string | null
          source_name: string
          source_url: string
          title?: string | null
          variant_raw?: string | null
          year?: number | null
        }
        Update: {
          alert_emitted?: boolean | null
          asking_price?: number | null
          confidence?: string | null
          created_at?: string | null
          decision?: string | null
          dedup_key?: string
          discovered_at?: string | null
          expired_at?: string | null
          extraction_error?: string | null
          hunt_id?: string
          id?: string
          km?: number | null
          location?: string | null
          make?: string | null
          match_score?: number | null
          model?: string | null
          raw_snippet?: string | null
          scored_at?: string | null
          source_name?: string
          source_url?: string
          title?: string | null
          variant_raw?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_external_candidates_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_matches: {
        Row: {
          asking_price: number | null
          confidence_label: string
          decision: string
          gap_dollars: number | null
          gap_pct: number | null
          hunt_id: string
          id: string
          lane: string | null
          listing_id: string
          match_score: number
          matched_at: string
          priority_score: number | null
          proven_exit_value: number | null
          reasons: string[] | null
        }
        Insert: {
          asking_price?: number | null
          confidence_label: string
          decision: string
          gap_dollars?: number | null
          gap_pct?: number | null
          hunt_id: string
          id?: string
          lane?: string | null
          listing_id: string
          match_score: number
          matched_at?: string
          priority_score?: number | null
          proven_exit_value?: number | null
          reasons?: string[] | null
        }
        Update: {
          asking_price?: number | null
          confidence_label?: string
          decision?: string
          gap_dollars?: number | null
          gap_pct?: number | null
          hunt_id?: string
          id?: string
          lane?: string | null
          listing_id?: string
          match_score?: number
          matched_at?: string
          priority_score?: number | null
          proven_exit_value?: number | null
          reasons?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_matches_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_scans: {
        Row: {
          alerts_emitted: number | null
          candidates_checked: number | null
          completed_at: string | null
          error: string | null
          hunt_id: string
          id: string
          matches_found: number | null
          metadata: Json | null
          source: string | null
          started_at: string
          status: string
        }
        Insert: {
          alerts_emitted?: number | null
          candidates_checked?: number | null
          completed_at?: string | null
          error?: string | null
          hunt_id: string
          id?: string
          matches_found?: number | null
          metadata?: Json | null
          source?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          alerts_emitted?: number | null
          candidates_checked?: number | null
          completed_at?: string | null
          error?: string | null
          hunt_id?: string
          id?: string
          matches_found?: number | null
          metadata?: Json | null
          source?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hunt_scans_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_search_tasks: {
        Row: {
          candidates_found: number | null
          completed_at: string | null
          created_at: string | null
          error: string | null
          hunt_id: string
          id: string
          search_query: string | null
          source_name: string
          started_at: string | null
          status: string | null
        }
        Insert: {
          candidates_found?: number | null
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          hunt_id: string
          id?: string
          search_query?: string | null
          source_name: string
          started_at?: string | null
          status?: string | null
        }
        Update: {
          candidates_found?: number | null
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          hunt_id?: string
          id?: string
          search_query?: string | null
          source_name?: string
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_search_tasks_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_web_sources: {
        Row: {
          base_url: string
          created_at: string | null
          display_name: string
          enabled: boolean | null
          id: string
          last_searched_at: string | null
          name: string
          notes: string | null
          parser_type: string
          priority: number | null
          rate_limit_per_hour: number | null
          search_url_template: string | null
          source_type: string
          updated_at: string | null
        }
        Insert: {
          base_url: string
          created_at?: string | null
          display_name: string
          enabled?: boolean | null
          id?: string
          last_searched_at?: string | null
          name: string
          notes?: string | null
          parser_type?: string
          priority?: number | null
          rate_limit_per_hour?: number | null
          search_url_template?: string | null
          source_type?: string
          updated_at?: string | null
        }
        Update: {
          base_url?: string
          created_at?: string | null
          display_name?: string
          enabled?: boolean | null
          id?: string
          last_searched_at?: string | null
          name?: string
          notes?: string | null
          parser_type?: string
          priority?: number | null
          rate_limit_per_hour?: number | null
          search_url_template?: string | null
          source_type?: string
          updated_at?: string | null
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
      listing_classify_queue: {
        Row: {
          error: string | null
          id: string
          listing_id: string
          processed_at: string | null
          queued_at: string | null
        }
        Insert: {
          error?: string | null
          id?: string
          listing_id: string
          processed_at?: string | null
          queued_at?: string | null
        }
        Update: {
          error?: string | null
          id?: string
          listing_id?: string
          processed_at?: string | null
          queued_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_classify_queue_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "potential_cross_posts"
            referencedColumns: ["listing_a_id"]
          },
          {
            foreignKeyName: "listing_classify_queue_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "potential_cross_posts"
            referencedColumns: ["listing_b_id"]
          },
          {
            foreignKeyName: "listing_classify_queue_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "retail_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_events: {
        Row: {
          created_at: string
          event_at: string
          event_type: string
          id: string
          listing_id: string
          meta: Json | null
          new_price: number | null
          new_status: string | null
          previous_price: number | null
          previous_status: string | null
          run_id: string | null
        }
        Insert: {
          created_at?: string
          event_at?: string
          event_type: string
          id?: string
          listing_id: string
          meta?: Json | null
          new_price?: number | null
          new_status?: string | null
          previous_price?: number | null
          previous_status?: string | null
          run_id?: string | null
        }
        Update: {
          created_at?: string
          event_at?: string
          event_type?: string
          id?: string
          listing_id?: string
          meta?: Json | null
          new_price?: number | null
          new_status?: string | null
          previous_price?: number | null
          previous_status?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_price_history: {
        Row: {
          currency: string | null
          id: number
          observed_at: string
          price: number
          run_id: string | null
          source: string
          source_listing_id: string
        }
        Insert: {
          currency?: string | null
          id?: number
          observed_at?: string
          price: number
          run_id?: string | null
          source: string
          source_listing_id: string
        }
        Update: {
          currency?: string | null
          id?: number
          observed_at?: string
          price?: number
          run_id?: string | null
          source?: string
          source_listing_id?: string
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
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
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
      model_taxonomy: {
        Row: {
          badge_tiers: Json
          body_types_allowed: string[] | null
          created_at: string | null
          engine_families_allowed: string[] | null
          id: string
          make: string
          model_root: string
          notes: string | null
          series_family: string
          updated_at: string | null
        }
        Insert: {
          badge_tiers?: Json
          body_types_allowed?: string[] | null
          created_at?: string | null
          engine_families_allowed?: string[] | null
          id?: string
          make: string
          model_root: string
          notes?: string | null
          series_family: string
          updated_at?: string | null
        }
        Update: {
          badge_tiers?: Json
          body_types_allowed?: string[] | null
          created_at?: string | null
          engine_families_allowed?: string[] | null
          id?: string
          make?: string
          model_root?: string
          notes?: string | null
          series_family?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          completed_steps: number | null
          created_at: string
          error_summary: string | null
          failed_steps: number | null
          id: string
          started_at: string
          status: string
          total_steps: number | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: number | null
          created_at?: string
          error_summary?: string | null
          failed_steps?: number | null
          id?: string
          started_at?: string
          status?: string
          total_steps?: number | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_steps?: number | null
          created_at?: string
          error_summary?: string | null
          failed_steps?: number | null
          id?: string
          started_at?: string
          status?: string
          total_steps?: number | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      pipeline_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          error_sample: string | null
          id: string
          metadata: Json | null
          records_created: number | null
          records_failed: number | null
          records_processed: number | null
          records_updated: number | null
          run_id: string
          started_at: string | null
          status: string
          step_name: string
          step_order: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_sample?: string | null
          id?: string
          metadata?: Json | null
          records_created?: number | null
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          run_id: string
          started_at?: string | null
          status?: string
          step_name: string
          step_order: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_sample?: string | null
          id?: string
          metadata?: Json | null
          records_created?: number | null
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          run_id?: string
          started_at?: string | null
          status?: string
          step_name?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      proven_exits: {
        Row: {
          computed_at: string
          confidence_label: string | null
          contributing_dealer_ids: string[] | null
          data_sources: string[] | null
          exit_method: string
          exit_value: number
          id: string
          identity_id: string
          km_band_used: string
          newest_sale_date: string | null
          oldest_sale_date: string | null
          recency_weighted: boolean | null
          region_scope: string
          sale_recency_days: number | null
          sample_size: number
          updated_at: string
        }
        Insert: {
          computed_at?: string
          confidence_label?: string | null
          contributing_dealer_ids?: string[] | null
          data_sources?: string[] | null
          exit_method?: string
          exit_value: number
          id?: string
          identity_id: string
          km_band_used: string
          newest_sale_date?: string | null
          oldest_sale_date?: string | null
          recency_weighted?: boolean | null
          region_scope?: string
          sale_recency_days?: number | null
          sample_size?: number
          updated_at?: string
        }
        Update: {
          computed_at?: string
          confidence_label?: string | null
          contributing_dealer_ids?: string[] | null
          data_sources?: string[] | null
          exit_method?: string
          exit_value?: number
          id?: string
          identity_id?: string
          km_band_used?: string
          newest_sale_date?: string | null
          oldest_sale_date?: string | null
          recency_weighted?: boolean | null
          region_scope?: string
          sale_recency_days?: number | null
          sample_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proven_exits_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: true
            referencedRelation: "vehicle_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_listing_events: {
        Row: {
          created_at: string
          days_live: number | null
          event_at: string
          event_date: string
          event_type: string
          id: number
          lat: number | null
          lga: string | null
          listing_id: string
          lng: number | null
          make: string | null
          meta: Json | null
          model: string | null
          postcode: string | null
          price: number | null
          run_id: string | null
          sa2: string | null
          sa3: string | null
          sa4: string | null
          source: string
          source_listing_id: string
          state: string | null
          suburb: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          days_live?: number | null
          event_at?: string
          event_date?: string
          event_type: string
          id?: number
          lat?: number | null
          lga?: string | null
          listing_id: string
          lng?: number | null
          make?: string | null
          meta?: Json | null
          model?: string | null
          postcode?: string | null
          price?: number | null
          run_id?: string | null
          sa2?: string | null
          sa3?: string | null
          sa4?: string | null
          source: string
          source_listing_id: string
          state?: string | null
          suburb?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          days_live?: number | null
          event_at?: string
          event_date?: string
          event_type?: string
          id?: number
          lat?: number | null
          lga?: string | null
          listing_id?: string
          lng?: number | null
          make?: string | null
          meta?: Json | null
          model?: string | null
          postcode?: string | null
          price?: number | null
          run_id?: string | null
          sa2?: string | null
          sa3?: string | null
          sa4?: string | null
          source?: string
          source_listing_id?: string
          state?: string | null
          suburb?: string | null
          year?: number | null
        }
        Relationships: []
      }
      retail_listings: {
        Row: {
          anomaly_sold_returned: boolean
          asking_price: number
          badge: string | null
          badge_tier: number | null
          body_type: string | null
          cab_confidence: string | null
          cab_reasons: string[] | null
          cab_source: string | null
          cab_type: string | null
          classified_at: string | null
          created_at: string
          cross_post_confidence: number | null
          cross_post_linked_at: string | null
          cylinders: number | null
          delisted_at: string | null
          description: string | null
          engine_code: string | null
          engine_family: string | null
          engine_litres: number | null
          exclude_from_alerts: boolean
          first_seen_at: string
          id: string
          identity_id: string | null
          identity_mapped_at: string | null
          km: number | null
          last_evaluated_at: string | null
          last_evaluation_result: string | null
          last_price: number | null
          last_price_changed_at: string | null
          last_seen_at: string
          last_seen_run_id: string | null
          lat: number | null
          lga: string | null
          lifecycle_status: string | null
          linked_from_listing_id: string | null
          linked_reason: string | null
          listing_url: string | null
          lng: number | null
          make: string
          model: string
          model_root: string | null
          origin_entity: string | null
          postcode: string | null
          price_change_count: number | null
          price_changed_at: string | null
          price_history: Json | null
          region_id: string | null
          region_raw: string | null
          relisted_at: string | null
          risk_flags: string[]
          sa2: string | null
          sa3: string | null
          sa4: string | null
          seller_name_raw: string | null
          seller_phone_hash: string | null
          seller_type: string | null
          series_family: string | null
          sold_returned_at: string | null
          source: string
          source_chain: Json | null
          source_listing_id: string
          source_type: string | null
          state: string | null
          suburb: string | null
          times_seen: number | null
          title: string | null
          updated_at: string
          variant_confidence: string | null
          variant_family: string | null
          variant_raw: string | null
          variant_reasons: string[] | null
          variant_source: string | null
          vehicle_instance_id: string | null
          year: number
        }
        Insert: {
          anomaly_sold_returned?: boolean
          asking_price: number
          badge?: string | null
          badge_tier?: number | null
          body_type?: string | null
          cab_confidence?: string | null
          cab_reasons?: string[] | null
          cab_source?: string | null
          cab_type?: string | null
          classified_at?: string | null
          created_at?: string
          cross_post_confidence?: number | null
          cross_post_linked_at?: string | null
          cylinders?: number | null
          delisted_at?: string | null
          description?: string | null
          engine_code?: string | null
          engine_family?: string | null
          engine_litres?: number | null
          exclude_from_alerts?: boolean
          first_seen_at?: string
          id?: string
          identity_id?: string | null
          identity_mapped_at?: string | null
          km?: number | null
          last_evaluated_at?: string | null
          last_evaluation_result?: string | null
          last_price?: number | null
          last_price_changed_at?: string | null
          last_seen_at?: string
          last_seen_run_id?: string | null
          lat?: number | null
          lga?: string | null
          lifecycle_status?: string | null
          linked_from_listing_id?: string | null
          linked_reason?: string | null
          listing_url?: string | null
          lng?: number | null
          make: string
          model: string
          model_root?: string | null
          origin_entity?: string | null
          postcode?: string | null
          price_change_count?: number | null
          price_changed_at?: string | null
          price_history?: Json | null
          region_id?: string | null
          region_raw?: string | null
          relisted_at?: string | null
          risk_flags?: string[]
          sa2?: string | null
          sa3?: string | null
          sa4?: string | null
          seller_name_raw?: string | null
          seller_phone_hash?: string | null
          seller_type?: string | null
          series_family?: string | null
          sold_returned_at?: string | null
          source: string
          source_chain?: Json | null
          source_listing_id: string
          source_type?: string | null
          state?: string | null
          suburb?: string | null
          times_seen?: number | null
          title?: string | null
          updated_at?: string
          variant_confidence?: string | null
          variant_family?: string | null
          variant_raw?: string | null
          variant_reasons?: string[] | null
          variant_source?: string | null
          vehicle_instance_id?: string | null
          year: number
        }
        Update: {
          anomaly_sold_returned?: boolean
          asking_price?: number
          badge?: string | null
          badge_tier?: number | null
          body_type?: string | null
          cab_confidence?: string | null
          cab_reasons?: string[] | null
          cab_source?: string | null
          cab_type?: string | null
          classified_at?: string | null
          created_at?: string
          cross_post_confidence?: number | null
          cross_post_linked_at?: string | null
          cylinders?: number | null
          delisted_at?: string | null
          description?: string | null
          engine_code?: string | null
          engine_family?: string | null
          engine_litres?: number | null
          exclude_from_alerts?: boolean
          first_seen_at?: string
          id?: string
          identity_id?: string | null
          identity_mapped_at?: string | null
          km?: number | null
          last_evaluated_at?: string | null
          last_evaluation_result?: string | null
          last_price?: number | null
          last_price_changed_at?: string | null
          last_seen_at?: string
          last_seen_run_id?: string | null
          lat?: number | null
          lga?: string | null
          lifecycle_status?: string | null
          linked_from_listing_id?: string | null
          linked_reason?: string | null
          listing_url?: string | null
          lng?: number | null
          make?: string
          model?: string
          model_root?: string | null
          origin_entity?: string | null
          postcode?: string | null
          price_change_count?: number | null
          price_changed_at?: string | null
          price_history?: Json | null
          region_id?: string | null
          region_raw?: string | null
          relisted_at?: string | null
          risk_flags?: string[]
          sa2?: string | null
          sa3?: string | null
          sa4?: string | null
          seller_name_raw?: string | null
          seller_phone_hash?: string | null
          seller_type?: string | null
          series_family?: string | null
          sold_returned_at?: string | null
          source?: string
          source_chain?: Json | null
          source_listing_id?: string
          source_type?: string | null
          state?: string | null
          suburb?: string | null
          times_seen?: number | null
          title?: string | null
          updated_at?: string
          variant_confidence?: string | null
          variant_family?: string | null
          variant_raw?: string | null
          variant_reasons?: string[] | null
          variant_source?: string | null
          vehicle_instance_id?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "retail_listings_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "vehicle_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_seed_cursor: {
        Row: {
          batches_completed: number | null
          completed_at: string | null
          id: string
          last_done_log_at: string | null
          last_error: string | null
          lock_token: string | null
          locked_until: string | null
          make_idx: number
          page: number
          started_at: string | null
          state_idx: number
          status: string
          total_errors: number | null
          total_evaluations: number | null
          total_new: number | null
          total_updated: number | null
          updated_at: string | null
        }
        Insert: {
          batches_completed?: number | null
          completed_at?: string | null
          id?: string
          last_done_log_at?: string | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          make_idx?: number
          page?: number
          started_at?: string | null
          state_idx?: number
          status?: string
          total_errors?: number | null
          total_evaluations?: number | null
          total_new?: number | null
          total_updated?: number | null
          updated_at?: string | null
        }
        Update: {
          batches_completed?: number | null
          completed_at?: string | null
          id?: string
          last_done_log_at?: string | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          make_idx?: number
          page?: number
          started_at?: string | null
          state_idx?: number
          status?: string
          total_errors?: number | null
          total_evaluations?: number | null
          total_new?: number | null
          total_updated?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      retail_seed_cursor_autotrader: {
        Row: {
          batch_idx: number
          batches_completed: number | null
          completed_at: string | null
          id: string
          last_done_log_at: string | null
          last_error: string | null
          lock_token: string | null
          locked_until: string | null
          make_idx: number
          started_at: string | null
          state_idx: number
          status: string
          total_errors: number | null
          total_evaluations: number | null
          total_new: number | null
          total_updated: number | null
          updated_at: string | null
        }
        Insert: {
          batch_idx?: number
          batches_completed?: number | null
          completed_at?: string | null
          id?: string
          last_done_log_at?: string | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          make_idx?: number
          started_at?: string | null
          state_idx?: number
          status?: string
          total_errors?: number | null
          total_evaluations?: number | null
          total_new?: number | null
          total_updated?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_idx?: number
          batches_completed?: number | null
          completed_at?: string | null
          id?: string
          last_done_log_at?: string | null
          last_error?: string | null
          lock_token?: string | null
          locked_until?: string | null
          make_idx?: number
          started_at?: string | null
          state_idx?: number
          status?: string
          total_errors?: number | null
          total_evaluations?: number | null
          total_new?: number | null
          total_updated?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sale_hunts: {
        Row: {
          badge: string | null
          badge_tier: number | null
          body_type: string | null
          cab_type: string | null
          created_at: string
          cylinders: number | null
          dealer_id: string
          drivetrain: string | null
          engine_code: string | null
          engine_family: string | null
          engine_litres: number | null
          expires_at: string | null
          fuel: string | null
          geo_mode: string
          id: string
          include_private: boolean
          km: number | null
          km_band: string | null
          km_tolerance_pct: number
          last_scan_at: string | null
          make: string
          max_listing_age_days_buy: number
          max_listing_age_days_watch: number
          min_gap_abs_buy: number
          min_gap_abs_watch: number
          min_gap_pct_buy: number
          min_gap_pct_watch: number
          model: string
          model_root: string | null
          must_have_mode: string | null
          must_have_raw: string | null
          must_have_tokens: string[] | null
          notes: string | null
          outward_enabled: boolean | null
          outward_sources: string[] | null
          priority: number
          proven_exit_method: string
          proven_exit_value: number | null
          radius_km: number | null
          scan_interval_minutes: number
          series_family: string | null
          source_sale_id: string | null
          sources_enabled: string[]
          states: string[] | null
          status: string
          transmission: string | null
          variant_confidence: string | null
          variant_family: string | null
          variant_reasons: string[] | null
          variant_source: string | null
          year: number
        }
        Insert: {
          badge?: string | null
          badge_tier?: number | null
          body_type?: string | null
          cab_type?: string | null
          created_at?: string
          cylinders?: number | null
          dealer_id: string
          drivetrain?: string | null
          engine_code?: string | null
          engine_family?: string | null
          engine_litres?: number | null
          expires_at?: string | null
          fuel?: string | null
          geo_mode?: string
          id?: string
          include_private?: boolean
          km?: number | null
          km_band?: string | null
          km_tolerance_pct?: number
          last_scan_at?: string | null
          make: string
          max_listing_age_days_buy?: number
          max_listing_age_days_watch?: number
          min_gap_abs_buy?: number
          min_gap_abs_watch?: number
          min_gap_pct_buy?: number
          min_gap_pct_watch?: number
          model: string
          model_root?: string | null
          must_have_mode?: string | null
          must_have_raw?: string | null
          must_have_tokens?: string[] | null
          notes?: string | null
          outward_enabled?: boolean | null
          outward_sources?: string[] | null
          priority?: number
          proven_exit_method?: string
          proven_exit_value?: number | null
          radius_km?: number | null
          scan_interval_minutes?: number
          series_family?: string | null
          source_sale_id?: string | null
          sources_enabled?: string[]
          states?: string[] | null
          status?: string
          transmission?: string | null
          variant_confidence?: string | null
          variant_family?: string | null
          variant_reasons?: string[] | null
          variant_source?: string | null
          year: number
        }
        Update: {
          badge?: string | null
          badge_tier?: number | null
          body_type?: string | null
          cab_type?: string | null
          created_at?: string
          cylinders?: number | null
          dealer_id?: string
          drivetrain?: string | null
          engine_code?: string | null
          engine_family?: string | null
          engine_litres?: number | null
          expires_at?: string | null
          fuel?: string | null
          geo_mode?: string
          id?: string
          include_private?: boolean
          km?: number | null
          km_band?: string | null
          km_tolerance_pct?: number
          last_scan_at?: string | null
          make?: string
          max_listing_age_days_buy?: number
          max_listing_age_days_watch?: number
          min_gap_abs_buy?: number
          min_gap_abs_watch?: number
          min_gap_pct_buy?: number
          min_gap_pct_watch?: number
          model?: string
          model_root?: string | null
          must_have_mode?: string | null
          must_have_raw?: string | null
          must_have_tokens?: string[] | null
          notes?: string | null
          outward_enabled?: boolean | null
          outward_sources?: string[] | null
          priority?: number
          proven_exit_method?: string
          proven_exit_value?: number | null
          radius_km?: number | null
          scan_interval_minutes?: number
          series_family?: string | null
          source_sale_id?: string | null
          sources_enabled?: string[]
          states?: string[] | null
          status?: string
          transmission?: string | null
          variant_confidence?: string | null
          variant_family?: string | null
          variant_reasons?: string[] | null
          variant_source?: string | null
          year?: number
        }
        Relationships: []
      }
      sales_evidence: {
        Row: {
          confidence_score: number | null
          created_at: string
          days_to_exit: number | null
          dealer_id: string | null
          dealer_name: string | null
          exit_date: string
          exit_price: number
          gross_profit: number | null
          id: string
          identity_id: string
          km_at_exit: number | null
          region_scope: string | null
          source_row_id: string
          source_type: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          days_to_exit?: number | null
          dealer_id?: string | null
          dealer_name?: string | null
          exit_date: string
          exit_price: number
          gross_profit?: number | null
          id?: string
          identity_id: string
          km_at_exit?: number | null
          region_scope?: string | null
          source_row_id: string
          source_type: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          days_to_exit?: number | null
          dealer_id?: string | null
          dealer_name?: string | null
          exit_date?: string
          exit_price?: number
          gross_profit?: number | null
          id?: string
          identity_id?: string
          km_at_exit?: number | null
          region_scope?: string | null
          source_row_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_evidence_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "vehicle_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_import_batches: {
        Row: {
          completed_at: string | null
          created_at: string | null
          dealer_id: string
          dealer_name: string | null
          error_message: string | null
          file_name: string | null
          id: string
          imported_by: string | null
          imported_count: number | null
          rejected_count: number | null
          row_count: number | null
          source_type: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          dealer_id: string
          dealer_name?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_count?: number | null
          rejected_count?: number | null
          row_count?: number | null
          source_type?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          dealer_id?: string
          dealer_name?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_count?: number | null
          rejected_count?: number | null
          row_count?: number | null
          source_type?: string
          status?: string
        }
        Relationships: []
      }
      sales_import_mappings: {
        Row: {
          column_map: Json
          created_at: string | null
          dealer_id: string
          dealer_name: string | null
          id: string
          last_used_at: string | null
          updated_at: string | null
        }
        Insert: {
          column_map?: Json
          created_at?: string | null
          dealer_id: string
          dealer_name?: string | null
          id?: string
          last_used_at?: string | null
          updated_at?: string | null
        }
        Update: {
          column_map?: Json
          created_at?: string | null
          dealer_id?: string
          dealer_name?: string | null
          id?: string
          last_used_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sales_normalised: {
        Row: {
          days_in_stock: number | null
          dealer_name: string | null
          drivetrain: string | null
          fuel: string | null
          gross_profit: number | null
          id: number
          km: number | null
          make: string | null
          model: string | null
          region_id: string | null
          sale_date: string | null
          sale_price: number | null
          source_row_id: string | null
          transmission: string | null
          updated_at: string | null
          variant_family: string | null
          variant_used: string | null
          year: number | null
        }
        Insert: {
          days_in_stock?: number | null
          dealer_name?: string | null
          drivetrain?: string | null
          fuel?: string | null
          gross_profit?: number | null
          id?: number
          km?: number | null
          make?: string | null
          model?: string | null
          region_id?: string | null
          sale_date?: string | null
          sale_price?: number | null
          source_row_id?: string | null
          transmission?: string | null
          updated_at?: string | null
          variant_family?: string | null
          variant_used?: string | null
          year?: number | null
        }
        Update: {
          days_in_stock?: number | null
          dealer_name?: string | null
          drivetrain?: string | null
          fuel?: string | null
          gross_profit?: number | null
          id?: number
          km?: number | null
          make?: string | null
          model?: string | null
          region_id?: string | null
          sale_date?: string | null
          sale_price?: number | null
          source_row_id?: string | null
          transmission?: string | null
          updated_at?: string | null
          variant_family?: string | null
          variant_used?: string | null
          year?: number | null
        }
        Relationships: []
      }
      sales_triggers: {
        Row: {
          acknowledged_at: string | null
          asking_price: number
          confidence_label: string
          config_version: string | null
          created_at: string
          evaluation_id: string | null
          expired_at: string | null
          gap_dollars: number
          gap_pct: number
          id: string
          identity_id: string
          km: number | null
          listing_id: string
          listing_url: string | null
          location: string | null
          make: string
          model: string
          notify_reason: string | null
          proven_exit_summary: string | null
          proven_exit_value: number
          sample_size: number
          sent_at: string | null
          sent_price: number | null
          should_notify: boolean
          target_dealer_ids: string[] | null
          target_region_id: string | null
          trigger_type: string
          updated_at: string | null
          variant_family: string | null
          year: number
        }
        Insert: {
          acknowledged_at?: string | null
          asking_price: number
          confidence_label: string
          config_version?: string | null
          created_at?: string
          evaluation_id?: string | null
          expired_at?: string | null
          gap_dollars: number
          gap_pct: number
          id?: string
          identity_id: string
          km?: number | null
          listing_id: string
          listing_url?: string | null
          location?: string | null
          make: string
          model: string
          notify_reason?: string | null
          proven_exit_summary?: string | null
          proven_exit_value: number
          sample_size: number
          sent_at?: string | null
          sent_price?: number | null
          should_notify?: boolean
          target_dealer_ids?: string[] | null
          target_region_id?: string | null
          trigger_type: string
          updated_at?: string | null
          variant_family?: string | null
          year: number
        }
        Update: {
          acknowledged_at?: string | null
          asking_price?: number
          confidence_label?: string
          config_version?: string | null
          created_at?: string
          evaluation_id?: string | null
          expired_at?: string | null
          gap_dollars?: number
          gap_pct?: number
          id?: string
          identity_id?: string
          km?: number | null
          listing_id?: string
          listing_url?: string | null
          location?: string | null
          make?: string
          model?: string
          notify_reason?: string | null
          proven_exit_summary?: string | null
          proven_exit_value?: number
          sample_size?: number
          sent_at?: string | null
          sent_price?: number | null
          should_notify?: boolean
          target_dealer_ids?: string[] | null
          target_region_id?: string | null
          trigger_type?: string
          updated_at?: string | null
          variant_family?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_triggers_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "trigger_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_triggers_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "trigger_evaluations_recent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_triggers_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "trigger_qa_recent"
            referencedColumns: ["evaluation_id"]
          },
          {
            foreignKeyName: "sales_triggers_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "vehicle_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      source_lane_map: {
        Row: {
          lane: string
          lane_bonus: number
          notes: string | null
          source: string
        }
        Insert: {
          lane: string
          lane_bonus?: number
          notes?: string | null
          source: string
        }
        Update: {
          lane?: string
          lane_bonus?: number
          notes?: string | null
          source?: string
        }
        Relationships: []
      }
      source_registry: {
        Row: {
          base_url: string | null
          created_at: string
          enabled: boolean
          geo_required: boolean
          ingest_lane: string | null
          notes: string | null
          source: string
          source_type: string
          stale_days: number
          supports_identity_relist: boolean
          supports_price_history: boolean
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          geo_required?: boolean
          ingest_lane?: string | null
          notes?: string | null
          source: string
          source_type: string
          stale_days?: number
          supports_identity_relist?: boolean
          supports_price_history?: boolean
        }
        Update: {
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          geo_required?: boolean
          ingest_lane?: string | null
          notes?: string | null
          source?: string
          source_type?: string
          stale_days?: number
          supports_identity_relist?: boolean
          supports_price_history?: boolean
        }
        Relationships: []
      }
      source_runs: {
        Row: {
          finished_at: string | null
          listings_new: number | null
          listings_processed: number | null
          listings_updated: number | null
          meta: Json | null
          run_id: string
          source: string
          started_at: string
        }
        Insert: {
          finished_at?: string | null
          listings_new?: number | null
          listings_processed?: number | null
          listings_updated?: number | null
          meta?: Json | null
          run_id?: string
          source: string
          started_at?: string
        }
        Update: {
          finished_at?: string | null
          listings_new?: number | null
          listings_processed?: number | null
          listings_updated?: number | null
          meta?: Json | null
          run_id?: string
          source?: string
          started_at?: string
        }
        Relationships: []
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
      trigger_config: {
        Row: {
          active_from: string | null
          active_to: string | null
          created_at: string
          exit_method: string | null
          guardrail_max_gap: number | null
          guardrail_type: string
          guardrail_value_abs: number | null
          guardrail_value_pct: number | null
          id: string
          is_provisional: boolean | null
          max_listing_age_days_buy: number | null
          max_listing_age_days_watch: number | null
          max_sale_age_days_buy: number | null
          max_sale_age_days_watch: number | null
          min_confidence_buy: string | null
          min_sample_size_buy: number | null
          min_sample_size_watch: number | null
          provisional_notes: string | null
          realert_cooldown_hours: number | null
          realert_min_price_drop_pct: number | null
          version: string
          watch_min_gap_abs: number | null
          watch_min_gap_pct: number | null
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          created_at?: string
          exit_method?: string | null
          guardrail_max_gap?: number | null
          guardrail_type?: string
          guardrail_value_abs?: number | null
          guardrail_value_pct?: number | null
          id?: string
          is_provisional?: boolean | null
          max_listing_age_days_buy?: number | null
          max_listing_age_days_watch?: number | null
          max_sale_age_days_buy?: number | null
          max_sale_age_days_watch?: number | null
          min_confidence_buy?: string | null
          min_sample_size_buy?: number | null
          min_sample_size_watch?: number | null
          provisional_notes?: string | null
          realert_cooldown_hours?: number | null
          realert_min_price_drop_pct?: number | null
          version: string
          watch_min_gap_abs?: number | null
          watch_min_gap_pct?: number | null
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          created_at?: string
          exit_method?: string | null
          guardrail_max_gap?: number | null
          guardrail_type?: string
          guardrail_value_abs?: number | null
          guardrail_value_pct?: number | null
          id?: string
          is_provisional?: boolean | null
          max_listing_age_days_buy?: number | null
          max_listing_age_days_watch?: number | null
          max_sale_age_days_buy?: number | null
          max_sale_age_days_watch?: number | null
          min_confidence_buy?: string | null
          min_sample_size_buy?: number | null
          min_sample_size_watch?: number | null
          provisional_notes?: string | null
          realert_cooldown_hours?: number | null
          realert_min_price_drop_pct?: number | null
          version?: string
          watch_min_gap_abs?: number | null
          watch_min_gap_pct?: number | null
        }
        Relationships: []
      }
      trigger_evaluations: {
        Row: {
          confidence_label: string | null
          config_version: string
          created_at: string
          evaluated_at: string
          gap_dollars: number | null
          gap_pct: number | null
          gate_failures: string[] | null
          guardrail_abs_used: number | null
          guardrail_pct_used: number | null
          id: string
          identity_id: string
          km_band_used: string | null
          listing_age_days: number | null
          listing_id: string
          listing_km: number | null
          listing_price: number
          listing_source: string
          proven_exit_method: string | null
          proven_exit_value: number | null
          reasons: string[] | null
          region_scope: string | null
          result: string
          sale_recency_days: number | null
          sample_size: number | null
          snapshot: Json | null
        }
        Insert: {
          confidence_label?: string | null
          config_version: string
          created_at?: string
          evaluated_at?: string
          gap_dollars?: number | null
          gap_pct?: number | null
          gate_failures?: string[] | null
          guardrail_abs_used?: number | null
          guardrail_pct_used?: number | null
          id?: string
          identity_id: string
          km_band_used?: string | null
          listing_age_days?: number | null
          listing_id: string
          listing_km?: number | null
          listing_price: number
          listing_source: string
          proven_exit_method?: string | null
          proven_exit_value?: number | null
          reasons?: string[] | null
          region_scope?: string | null
          result: string
          sale_recency_days?: number | null
          sample_size?: number | null
          snapshot?: Json | null
        }
        Update: {
          confidence_label?: string | null
          config_version?: string
          created_at?: string
          evaluated_at?: string
          gap_dollars?: number | null
          gap_pct?: number | null
          gate_failures?: string[] | null
          guardrail_abs_used?: number | null
          guardrail_pct_used?: number | null
          id?: string
          identity_id?: string
          km_band_used?: string | null
          listing_age_days?: number | null
          listing_id?: string
          listing_km?: number | null
          listing_price?: number
          listing_source?: string
          proven_exit_method?: string | null
          proven_exit_value?: number | null
          reasons?: string[] | null
          region_scope?: string | null
          result?: string
          sale_recency_days?: number | null
          sample_size?: number | null
          snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "trigger_evaluations_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "vehicle_identities"
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
      va_sales_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          dealer_id: string
          dealer_name: string
          expected_frequency: string | null
          id: string
          last_data_received_at: string | null
          next_due_at: string | null
          notes: string | null
          priority: number | null
          rejection_reason: string | null
          status: string
          task_type: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          dealer_id: string
          dealer_name: string
          expected_frequency?: string | null
          id?: string
          last_data_received_at?: string | null
          next_due_at?: string | null
          notes?: string | null
          priority?: number | null
          rejection_reason?: string | null
          status?: string
          task_type?: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          dealer_id?: string
          dealer_name?: string
          expected_frequency?: string | null
          id?: string
          last_data_received_at?: string | null
          next_due_at?: string | null
          notes?: string | null
          priority?: number | null
          rejection_reason?: string | null
          status?: string
          task_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      va_sources: {
        Row: {
          created_at: string
          display_name: string
          enabled: boolean | null
          id: string
          location_hint: string | null
          source_key: string
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          enabled?: boolean | null
          id?: string
          location_hint?: string | null
          source_key: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          enabled?: boolean | null
          id?: string
          location_hint?: string | null
          source_key?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      va_tasks: {
        Row: {
          assigned_to: string | null
          attempt_count: number | null
          buy_window_at: string | null
          created_at: string
          due_at: string | null
          id: string
          listing_url: string | null
          listing_uuid: string
          note: string | null
          priority: string
          source_key: string | null
          status: string
          task_type: string
          updated_at: string
          watch_confidence: string | null
          watch_reason: string | null
        }
        Insert: {
          assigned_to?: string | null
          attempt_count?: number | null
          buy_window_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          listing_url?: string | null
          listing_uuid: string
          note?: string | null
          priority?: string
          source_key?: string | null
          status?: string
          task_type?: string
          updated_at?: string
          watch_confidence?: string | null
          watch_reason?: string | null
        }
        Update: {
          assigned_to?: string | null
          attempt_count?: number | null
          buy_window_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          listing_url?: string | null
          listing_uuid?: string
          note?: string | null
          priority?: string
          source_key?: string | null
          status?: string
          task_type?: string
          updated_at?: string
          watch_confidence?: string | null
          watch_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_tasks_listing_uuid_fkey"
            columns: ["listing_uuid"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      va_upload_batches: {
        Row: {
          auction_date: string
          created_at: string
          error: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          file_type: string
          id: string
          ingest_completed_at: string | null
          ingest_started_at: string | null
          metadata: Json | null
          parse_completed_at: string | null
          parse_started_at: string | null
          pdf_extract_notes: string | null
          pdf_extract_required: boolean | null
          rows_accepted: number | null
          rows_rejected: number | null
          rows_total: number | null
          source_key: string
          status: string
          uploaded_by: string | null
        }
        Insert: {
          auction_date: string
          created_at?: string
          error?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          file_type: string
          id?: string
          ingest_completed_at?: string | null
          ingest_started_at?: string | null
          metadata?: Json | null
          parse_completed_at?: string | null
          parse_started_at?: string | null
          pdf_extract_notes?: string | null
          pdf_extract_required?: boolean | null
          rows_accepted?: number | null
          rows_rejected?: number | null
          rows_total?: number | null
          source_key: string
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          auction_date?: string
          created_at?: string
          error?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          file_type?: string
          id?: string
          ingest_completed_at?: string | null
          ingest_started_at?: string | null
          metadata?: Json | null
          parse_completed_at?: string | null
          parse_started_at?: string | null
          pdf_extract_notes?: string | null
          pdf_extract_required?: boolean | null
          rows_accepted?: number | null
          rows_rejected?: number | null
          rows_total?: number | null
          source_key?: string
          status?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      va_upload_rows: {
        Row: {
          asking_price: number | null
          batch_id: string
          created_at: string
          fuel: string | null
          id: string
          km: number | null
          listing_id: string | null
          location: string | null
          lot_id: string | null
          make: string | null
          model: string | null
          raw_data: Json
          rejection_reason: string | null
          reserve: number | null
          row_number: number
          status: string
          stock_number: string | null
          transmission: string | null
          variant_family: string | null
          variant_raw: string | null
          vin: string | null
          year: number | null
        }
        Insert: {
          asking_price?: number | null
          batch_id: string
          created_at?: string
          fuel?: string | null
          id?: string
          km?: number | null
          listing_id?: string | null
          location?: string | null
          lot_id?: string | null
          make?: string | null
          model?: string | null
          raw_data?: Json
          rejection_reason?: string | null
          reserve?: number | null
          row_number: number
          status?: string
          stock_number?: string | null
          transmission?: string | null
          variant_family?: string | null
          variant_raw?: string | null
          vin?: string | null
          year?: number | null
        }
        Update: {
          asking_price?: number | null
          batch_id?: string
          created_at?: string
          fuel?: string | null
          id?: string
          km?: number | null
          listing_id?: string | null
          location?: string | null
          lot_id?: string | null
          make?: string | null
          model?: string | null
          raw_data?: Json
          rejection_reason?: string | null
          reserve?: number | null
          row_number?: number
          status?: string
          stock_number?: string | null
          transmission?: string | null
          variant_family?: string | null
          variant_raw?: string | null
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "va_upload_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "va_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing_presence_by_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "missed_buy_window"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "stale_dealer_grade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_deals_90_plus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "trap_inventory_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "va_upload_rows_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
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
      variant_audit: {
        Row: {
          classified_at: string | null
          confidence: string | null
          hunt_id: string | null
          id: string
          listing_id: string | null
          output_badge: string | null
          output_badge_tier: number | null
          output_body_type: string | null
          output_engine_family: string | null
          output_model_root: string | null
          output_series_family: string | null
          raw_title: string | null
          raw_url: string | null
          raw_variant: string | null
          reasons: string[] | null
          rules_applied: string[] | null
        }
        Insert: {
          classified_at?: string | null
          confidence?: string | null
          hunt_id?: string | null
          id?: string
          listing_id?: string | null
          output_badge?: string | null
          output_badge_tier?: number | null
          output_body_type?: string | null
          output_engine_family?: string | null
          output_model_root?: string | null
          output_series_family?: string | null
          raw_title?: string | null
          raw_url?: string | null
          raw_variant?: string | null
          reasons?: string[] | null
          rules_applied?: string[] | null
        }
        Update: {
          classified_at?: string | null
          confidence?: string | null
          hunt_id?: string | null
          id?: string
          listing_id?: string | null
          output_badge?: string | null
          output_badge_tier?: number | null
          output_body_type?: string | null
          output_engine_family?: string | null
          output_model_root?: string | null
          output_series_family?: string | null
          raw_title?: string | null
          raw_url?: string | null
          raw_variant?: string | null
          reasons?: string[] | null
          rules_applied?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_audit_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_audit_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "potential_cross_posts"
            referencedColumns: ["listing_a_id"]
          },
          {
            foreignKeyName: "variant_audit_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "potential_cross_posts"
            referencedColumns: ["listing_b_id"]
          },
          {
            foreignKeyName: "variant_audit_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "retail_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_rules: {
        Row: {
          apply_to: string
          confidence: string | null
          created_at: string | null
          enabled: boolean | null
          id: string
          make: string
          model_root: string
          notes: string | null
          pattern: string
          priority: number | null
          rule_type: string
          set_json: Json
          updated_at: string | null
        }
        Insert: {
          apply_to?: string
          confidence?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          make: string
          model_root: string
          notes?: string | null
          pattern: string
          priority?: number | null
          rule_type: string
          set_json?: Json
          updated_at?: string | null
        }
        Update: {
          apply_to?: string
          confidence?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          make?: string
          model_root?: string
          notes?: string | null
          pattern?: string
          priority?: number | null
          rule_type?: string
          set_json?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      vehicle_identities: {
        Row: {
          created_at: string
          drivetrain: string | null
          evidence_count: number | null
          evidence_updated_at: string | null
          fuel: string | null
          id: string
          identity_hash: string
          km_band: string
          last_evidence_at: string | null
          listing_count: number | null
          make: string
          model: string
          region_id: string
          transmission: string | null
          updated_at: string
          variant_family: string | null
          year_max: number
          year_min: number
        }
        Insert: {
          created_at?: string
          drivetrain?: string | null
          evidence_count?: number | null
          evidence_updated_at?: string | null
          fuel?: string | null
          id?: string
          identity_hash: string
          km_band: string
          last_evidence_at?: string | null
          listing_count?: number | null
          make: string
          model: string
          region_id?: string
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          year_max: number
          year_min: number
        }
        Update: {
          created_at?: string
          drivetrain?: string | null
          evidence_count?: number | null
          evidence_updated_at?: string | null
          fuel?: string | null
          id?: string
          identity_hash?: string
          km_band?: string
          last_evidence_at?: string | null
          listing_count?: number | null
          make?: string
          model?: string
          region_id?: string
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          year_max?: number
          year_min?: number
        }
        Relationships: []
      }
      vehicle_listings: {
        Row: {
          anomaly_sold_returned: boolean | null
          asking_price: number | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          assignment_notes: string | null
          attempt_count: number
          attempt_stage: string | null
          auction_datetime: string | null
          auction_history: Json | null
          auction_house: string | null
          avoid_reason: string | null
          buy_window_at: string | null
          dealer_name: string | null
          dealer_url: string | null
          drivetrain: string | null
          event_id: string | null
          exclude_from_alerts: boolean | null
          excluded_keyword: string | null
          excluded_reason: string | null
          external_id: string | null
          fingerprint: string | null
          fingerprint_confidence: number
          fingerprint_version: number
          first_seen_at: string
          fuel: string | null
          highest_bid: number | null
          id: string
          is_dealer_grade: boolean | null
          km: number | null
          last_attempt_at: string | null
          last_auction_date: string | null
          last_ingest_run_id: string | null
          last_ingested_at: string | null
          last_seen_at: string
          lifecycle_state: string
          linked_from_listing_id: string | null
          linked_reason: string | null
          listed_date_raw: string | null
          listing_id: string
          listing_url: string | null
          location: string | null
          lot_id: string | null
          make: string
          missing_streak: number
          model: string
          pass_count: number
          relist_count: number
          reserve: number | null
          risk_flags: string[] | null
          seller_confidence: string | null
          seller_reasons: string[] | null
          seller_type: string
          sold_returned_at: string | null
          sold_returned_flagged_at: string | null
          sold_returned_reason: string | null
          sold_returned_suspected: boolean
          source: string
          source_class: string
          status: string
          status_changed_at: string | null
          tracked_by: string | null
          transmission: string | null
          updated_at: string
          variant_family: string | null
          variant_raw: string | null
          variant_source: string | null
          variant_used: string | null
          visible_to_dealers: boolean
          watch_confidence: string | null
          watch_reason: string | null
          watch_status: string | null
          year: number
        }
        Insert: {
          anomaly_sold_returned?: boolean | null
          asking_price?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          assignment_notes?: string | null
          attempt_count?: number
          attempt_stage?: string | null
          auction_datetime?: string | null
          auction_history?: Json | null
          auction_house?: string | null
          avoid_reason?: string | null
          buy_window_at?: string | null
          dealer_name?: string | null
          dealer_url?: string | null
          drivetrain?: string | null
          event_id?: string | null
          exclude_from_alerts?: boolean | null
          excluded_keyword?: string | null
          excluded_reason?: string | null
          external_id?: string | null
          fingerprint?: string | null
          fingerprint_confidence?: number
          fingerprint_version?: number
          first_seen_at?: string
          fuel?: string | null
          highest_bid?: number | null
          id?: string
          is_dealer_grade?: boolean | null
          km?: number | null
          last_attempt_at?: string | null
          last_auction_date?: string | null
          last_ingest_run_id?: string | null
          last_ingested_at?: string | null
          last_seen_at?: string
          lifecycle_state?: string
          linked_from_listing_id?: string | null
          linked_reason?: string | null
          listed_date_raw?: string | null
          listing_id: string
          listing_url?: string | null
          location?: string | null
          lot_id?: string | null
          make: string
          missing_streak?: number
          model: string
          pass_count?: number
          relist_count?: number
          reserve?: number | null
          risk_flags?: string[] | null
          seller_confidence?: string | null
          seller_reasons?: string[] | null
          seller_type?: string
          sold_returned_at?: string | null
          sold_returned_flagged_at?: string | null
          sold_returned_reason?: string | null
          sold_returned_suspected?: boolean
          source?: string
          source_class?: string
          status?: string
          status_changed_at?: string | null
          tracked_by?: string | null
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          variant_raw?: string | null
          variant_source?: string | null
          variant_used?: string | null
          visible_to_dealers?: boolean
          watch_confidence?: string | null
          watch_reason?: string | null
          watch_status?: string | null
          year: number
        }
        Update: {
          anomaly_sold_returned?: boolean | null
          asking_price?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          assignment_notes?: string | null
          attempt_count?: number
          attempt_stage?: string | null
          auction_datetime?: string | null
          auction_history?: Json | null
          auction_house?: string | null
          avoid_reason?: string | null
          buy_window_at?: string | null
          dealer_name?: string | null
          dealer_url?: string | null
          drivetrain?: string | null
          event_id?: string | null
          exclude_from_alerts?: boolean | null
          excluded_keyword?: string | null
          excluded_reason?: string | null
          external_id?: string | null
          fingerprint?: string | null
          fingerprint_confidence?: number
          fingerprint_version?: number
          first_seen_at?: string
          fuel?: string | null
          highest_bid?: number | null
          id?: string
          is_dealer_grade?: boolean | null
          km?: number | null
          last_attempt_at?: string | null
          last_auction_date?: string | null
          last_ingest_run_id?: string | null
          last_ingested_at?: string | null
          last_seen_at?: string
          lifecycle_state?: string
          linked_from_listing_id?: string | null
          linked_reason?: string | null
          listed_date_raw?: string | null
          listing_id?: string
          listing_url?: string | null
          location?: string | null
          lot_id?: string | null
          make?: string
          missing_streak?: number
          model?: string
          pass_count?: number
          relist_count?: number
          reserve?: number | null
          risk_flags?: string[] | null
          seller_confidence?: string | null
          seller_reasons?: string[] | null
          seller_type?: string
          sold_returned_at?: string | null
          sold_returned_flagged_at?: string | null
          sold_returned_reason?: string | null
          sold_returned_suspected?: boolean
          source?: string
          source_class?: string
          status?: string
          status_changed_at?: string | null
          tracked_by?: string | null
          transmission?: string | null
          updated_at?: string
          variant_family?: string | null
          variant_raw?: string | null
          variant_source?: string | null
          variant_used?: string | null
          visible_to_dealers?: boolean
          watch_confidence?: string | null
          watch_reason?: string | null
          watch_status?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_listings_last_ingest_run_id_fkey"
            columns: ["last_ingest_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
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
      dealer_opportunity_21d: {
        Row: {
          cleared_count: number | null
          combined_score: number | null
          dealer_cleared_total: number | null
          demand_score: number | null
          distinct_sellers: number | null
          make: string | null
          median_days_to_clear: number | null
          model: string | null
          opportunity_label: string | null
          region_id: string | null
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
      fingerprint_benchmark_gaps: {
        Row: {
          avg_days_to_clear: number | null
          avg_price: number | null
          cleared_total: number | null
          listing_total: number | null
          make: string | null
          model: string | null
          region_id: string | null
          variant_family: string | null
          year_max: number | null
          year_min: number | null
        }
        Relationships: []
      }
      fingerprint_benchmark_watchlist: {
        Row: {
          avg_days_to_clear: number | null
          avg_price: number | null
          cleared_total: number | null
          confidence_level: string | null
          impact_score: number | null
          listing_total: number | null
          make: string | null
          missing_benchmark: boolean | null
          model: string | null
          region_id: string | null
          stale_benchmark: boolean | null
          thin_benchmark: boolean | null
          variant_family: string | null
          year_max: number | null
          year_min: number | null
        }
        Relationships: []
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
      hunt_matches_ranked: {
        Row: {
          asking_price: number | null
          confidence_label: string | null
          decision: string | null
          decision_rank: number | null
          gap_dollars: number | null
          gap_pct: number | null
          hunt_id: string | null
          id: string | null
          lane: string | null
          listing_id: string | null
          match_score: number | null
          matched_at: string | null
          priority_score: number | null
          proven_exit_value: number | null
          reasons: string[] | null
        }
        Insert: {
          asking_price?: number | null
          confidence_label?: string | null
          decision?: string | null
          decision_rank?: never
          gap_dollars?: number | null
          gap_pct?: number | null
          hunt_id?: string | null
          id?: string | null
          lane?: string | null
          listing_id?: string | null
          match_score?: number | null
          matched_at?: string | null
          priority_score?: number | null
          proven_exit_value?: number | null
          reasons?: string[] | null
        }
        Update: {
          asking_price?: number | null
          confidence_label?: string | null
          decision?: string | null
          decision_rank?: never
          gap_dollars?: number | null
          gap_pct?: number | null
          hunt_id?: string | null
          id?: string | null
          lane?: string | null
          listing_id?: string | null
          match_score?: number | null
          matched_at?: string | null
          priority_score?: number | null
          proven_exit_value?: number | null
          reasons?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_matches_hunt_id_fkey"
            columns: ["hunt_id"]
            isOneToOne: false
            referencedRelation: "sale_hunts"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_presence_by_run: {
        Row: {
          asking_price: number | null
          event_at: string | null
          event_type: string | null
          first_seen_at: string | null
          id: string | null
          km: number | null
          last_seen_at: string | null
          listing_id: string | null
          listing_url: string | null
          location: string | null
          make: string | null
          model: string | null
          run_id: string | null
          source: string | null
          status: string | null
          status_changed_at: string | null
          variant_family: string | null
          year: number | null
        }
        Relationships: []
      }
      missed_buy_window: {
        Row: {
          asking_price: number | null
          buy_window_at: string | null
          days_to_clear: number | null
          id: string | null
          km: number | null
          listing_id: string | null
          location: string | null
          make: string | null
          model: string | null
          sold_date: string | null
          source: string | null
          variant_used: string | null
          watch_confidence: string | null
          year: number | null
        }
        Relationships: []
      }
      model_strength_by_region: {
        Row: {
          avg_days_live: number | null
          avg_price: number | null
          delists_last_30d: number | null
          delists_last_7d: number | null
          make: string | null
          median_days_live: number | null
          model: string | null
          sa3: string | null
          state: string | null
          total_delists: number | null
        }
        Relationships: []
      }
      offmarket_heatmap_30d: {
        Row: {
          avg_days_live: number | null
          delist_count: number | null
          earliest_delist: string | null
          latest_delist: string | null
          lga: string | null
          make: string | null
          model: string | null
          sa2: string | null
          sa3: string | null
          state: string | null
          suburb: string | null
        }
        Relationships: []
      }
      potential_cross_posts: {
        Row: {
          km_a: number | null
          km_b: number | null
          km_diff: number | null
          listing_a_id: string | null
          listing_b_id: string | null
          make: string | null
          match_confidence: number | null
          model: string | null
          origin_a: string | null
          origin_b: string | null
          price_a: number | null
          price_b: number | null
          price_diff: number | null
          seller_phone_hash: string | null
          source_a: string | null
          source_b: string | null
          year: number | null
        }
        Relationships: []
      }
      regional_demand_21d: {
        Row: {
          cleared_count: number | null
          demand_score: number | null
          distinct_sellers: number | null
          make: string | null
          median_days_to_clear: number | null
          model: string | null
          region_id: string | null
        }
        Relationships: []
      }
      retail_ingest_stats: {
        Row: {
          active_listings_total: number | null
          autotrader_active: number | null
          autotrader_identity_pct: number | null
          autotrader_today: number | null
          autotrader_triggers_today: number | null
          buy_triggers_today: number | null
          evaluations_today: number | null
          gumtree_active: number | null
          gumtree_identity_pct: number | null
          gumtree_today: number | null
          gumtree_triggers_today: number | null
          identity_mapping_pct: number | null
          listings_scraped_today: number | null
          listings_with_identity: number | null
          triggers_today: number | null
          watch_triggers_today: number | null
        }
        Relationships: []
      }
      retail_origin_stats: {
        Row: {
          active_listings: number | null
          avg_per_day_7d: number | null
          first_contribution: string | null
          latest_contribution: string | null
          listings_30d: number | null
          listings_7d: number | null
          origin_entity: string | null
          seller_type: string | null
          source_count: number | null
          sources: string[] | null
          total_listings: number | null
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
      trap_operational_summary: {
        Row: {
          auto_crawling_count: number | null
          dormant_count: number | null
          operational_count: number | null
          portal_backed_count: number | null
          total_count: number | null
          va_fed_count: number | null
        }
        Relationships: []
      }
      trigger_dashboard_summary: {
        Row: {
          buy_evaluations_24h: number | null
          buy_triggers_24h: number | null
          evaluations_24h: number | null
          ignore_evaluations_24h: number | null
          proven_exits_updated_24h: number | null
          triggers_emitted_24h: number | null
          watch_evaluations_24h: number | null
          watch_triggers_24h: number | null
        }
        Relationships: []
      }
      trigger_evaluations_recent: {
        Row: {
          asking_price: number | null
          config_version: string | null
          evaluated_at: string | null
          gap_dollars: number | null
          gap_pct: number | null
          gate_failures: string[] | null
          id: string | null
          listing_id: string | null
          make: string | null
          model: string | null
          proven_exit_value: number | null
          reasons: string[] | null
          result: string | null
          year: number | null
        }
        Relationships: []
      }
      trigger_gate_failure_stats: {
        Row: {
          config_version: string | null
          count: number | null
          failure_type: string | null
        }
        Relationships: []
      }
      trigger_qa_recent: {
        Row: {
          asking_price: number | null
          confidence_label: string | null
          evaluated_at: string | null
          evaluation_id: string | null
          first_seen_at: string | null
          gap_dollars: number | null
          gap_pct: number | null
          gate_failures: string[] | null
          km: number | null
          listing_age_days: number | null
          listing_id: string | null
          listing_url: string | null
          make: string | null
          model: string | null
          proven_exit_value: number | null
          reasons: string[] | null
          result: string | null
          sale_recency_days: number | null
          sample_size: number | null
          snapshot: Json | null
          source: string | null
          variant_family: string | null
          year: number | null
        }
        Relationships: []
      }
      trigger_stats_by_result: {
        Row: {
          config_version: string | null
          count: number | null
          eval_date: string | null
          result: string | null
        }
        Relationships: []
      }
      triggers_emitted_24h: {
        Row: {
          asking_price: number | null
          config_version: string | null
          created_at: string | null
          gap_dollars: number | null
          gap_pct: number | null
          id: string | null
          listing_id: string | null
          make: string | null
          model: string | null
          proven_exit_used: number | null
          sent_at: string | null
          trigger_type: string | null
          year: number | null
        }
        Relationships: []
      }
      va_blocked_sources: {
        Row: {
          display_name: string | null
          last_checked_at: string | null
          preflight_status: string | null
          reason: string | null
          region_id: string | null
          source_key: string | null
          source_type: string | null
          url: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      autotrader_raw_seen: {
        Args: { p_payload: Json; p_price: number; p_source_listing_id: string }
        Returns: {
          is_new: boolean
          times_seen_now: number
        }[]
      }
      backfill_dealer_outcomes_from_sales: {
        Args: never
        Returns: {
          inserted: number
          skipped: number
        }[]
      }
      backfill_fingerprints_v2: {
        Args: { batch_size?: number }
        Returns: {
          remaining_count: number
          updated_count: number
        }[]
      }
      build_profit_fingerprint: {
        Args: {
          p_fuel: string
          p_km_band: string
          p_make: string
          p_model: string
          p_transmission: string
          p_variant_family: string
          p_year: number
        }
        Returns: string
      }
      calculate_auction_profit_score: {
        Args: {
          p_auction_date: string
          p_auction_house: string
          p_location: string
          p_top_n?: number
        }
        Returns: {
          auction_score: number
          avg_median_gp: number
          eligible_count: number
          profit_dense_count: number
          top_fingerprints: Json
          total_sample_size: number
        }[]
      }
      calculate_lot_profit_score: {
        Args: {
          p_exit_target_days?: number
          p_fuel: string
          p_gp_target?: number
          p_km: number
          p_location?: string
          p_make: string
          p_model: string
          p_region_id: string
          p_transmission: string
          p_variant_family: string
          p_year: number
        }
        Returns: {
          confidence_label: string
          geo_multiplier: number
          lot_score: number
          median_gp: number
          sample_size: number
          win_rate: number
        }[]
      }
      check_identity_linked_sold_returned: {
        Args: {
          p_identity_id: string
          p_listing_id: string
          p_source: string
          p_window_days?: number
        }
        Returns: Json
      }
      claim_autotrader_crawl_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          cursor_id: string
          make: string
          next_page: number
          state: string
        }[]
      }
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
      compute_identity_hash: {
        Args: {
          p_drivetrain: string
          p_fuel: string
          p_km_band: string
          p_make: string
          p_model: string
          p_region_id: string
          p_transmission: string
          p_variant_family: string
          p_year_max: number
          p_year_min: number
        }
        Returns: string
      }
      compute_proven_exit: {
        Args: { p_identity_id: string }
        Returns: undefined
      }
      create_auction_source: {
        Args: {
          p_display_name: string
          p_list_url: string
          p_platform: string
          p_region_hint: string
          p_source_key: string
        }
        Returns: undefined
      }
      create_hunt_from_sale: { Args: { p_sale_id: string }; Returns: string }
      derive_clearance_events: {
        Args: { p_stale_hours?: number }
        Returns: {
          events_created: number
          listings_processed: number
        }[]
      }
      derive_presence_events: {
        Args: { p_run_id: string; p_source?: string; p_stale_hours?: number }
        Returns: {
          new_listings: number
          returned: number
          still_active: number
          went_missing: number
        }[]
      }
      derive_presence_events_v2: {
        Args: { p_min_seen_pct?: number; p_run_id: string; p_source?: string }
        Returns: {
          circuit_breaker_tripped: boolean
          new_listings: number
          pending_missing: number
          returned: number
          seen_this_run: number
          still_active: number
          went_missing: number
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
      detect_sold_returned_suspects: {
        Args: never
        Returns: {
          flagged_count: number
          listing_id: string
          listing_uuid: string
          reason: string
        }[]
      }
      emit_sales_trigger:
        | { Args: { p_evaluation_id: string }; Returns: string }
        | {
            Args: {
              p_config_version: number
              p_evaluation_id: string
              p_gap_dollars: number
              p_gap_pct: number
              p_listing_id: string
              p_proven_exit_value: number
              p_trigger_type: string
            }
            Returns: string
          }
      escalate_stale_va_tasks: { Args: never; Returns: Json }
      evaluate_and_emit_trigger: {
        Args: { p_config_version: string; p_listing_id: string }
        Returns: {
          evaluation_id: string
          gap_dollars: number
          gap_pct: number
          gate_failures: string[]
          reasons: string[]
          result: string
          trigger_id: string
        }[]
      }
      evaluate_dealer_spec_matches_for_listing: {
        Args: { p_listing_uuid: string }
        Returns: {
          alerts_created: number
        }[]
      }
      evaluate_trigger: {
        Args: { p_config_version: string; p_listing_id: string }
        Returns: {
          evaluation_id: string
          gap_dollars: number
          gap_pct: number
          gate_failures: string[]
          reasons: string[]
          result: string
        }[]
      }
      evaluate_watch_status: {
        Args: { p_force_recalc?: boolean; p_listing_id: string }
        Returns: {
          avoid_reason: string
          new_reason: string
          new_status: string
          should_avoid: boolean
          watch_confidence: string
        }[]
      }
      find_recent_delisted_by_identity: {
        Args: {
          p_exclude_listing_id: string
          p_identity_id: string
          p_source: string
          p_window_days?: number
        }
        Returns: {
          anomaly_sold_returned: boolean
          delisted_at: string
          listing_id: string
          risk_flags: string[]
          source_listing_id: string
        }[]
      }
      flag_stale_buy_windows: { Args: never; Returns: Json }
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
      generate_sale_fingerprint: {
        Args: {
          p_km?: number
          p_make: string
          p_model: string
          p_region_id?: string
          p_variant_raw?: string
          p_year: number
        }
        Returns: {
          confidence: number
          fingerprint: string
        }[]
      }
      generate_vehicle_fingerprint: {
        Args: {
          p_body?: string
          p_drivetrain?: string
          p_fuel?: string
          p_km?: number
          p_make: string
          p_model: string
          p_region?: string
          p_transmission?: string
          p_variant?: string
          p_year: number
        }
        Returns: string
      }
      generate_vehicle_fingerprint_v2: {
        Args: {
          p_body: string
          p_drivetrain: string
          p_fuel: string
          p_km: number
          p_make: string
          p_model: string
          p_region: string
          p_transmission: string
          p_variant_family: string
          p_variant_raw: string
          p_year: number
        }
        Returns: {
          canonical: string
          fingerprint: string
          fingerprint_confidence: number
          variant_source: string
          variant_used: string
        }[]
      }
      get_auction_source_events: {
        Args: { p_limit?: number; p_source_key: string }
        Returns: {
          created_at: string
          event_type: string
          id: string
          message: string
          meta: Json
          source_key: string
        }[]
      }
      get_auction_source_stats: {
        Args: never
        Returns: {
          display_name: string
          enabled: boolean
          last_lots_found: number
          last_success_at: string
          platform: string
          region_hint: string
          source_key: string
          today_created: number
          today_dropped: number
          today_runs: number
          today_updated: number
        }[]
      }
      get_auction_sources_health: {
        Args: never
        Returns: {
          auto_disabled_at: string
          auto_disabled_reason: string
          consecutive_crawl_failures: number
          display_name: string
          enabled: boolean
          last_crawl_error: string
          last_crawl_fail_at: string
          last_crawl_success_at: string
          last_lots_found: number
          last_scheduled_run_at: string
          platform: string
          preflight_status: string
          schedule_days: string[]
          schedule_enabled: boolean
          schedule_pause_reason: string
          schedule_paused: boolean
          schedule_time_local: string
          source_key: string
        }[]
      }
      get_benchmark_coverage: {
        Args: never
        Returns: {
          benchmarked: number
          coverage_pct: number
          region_id: string
          total_deals: number
        }[]
      }
      get_benchmark_coverage_summary: {
        Args: never
        Returns: {
          benchmarked: number
          by_region: Json
          coverage_pct: number
          total_deals: number
        }[]
      }
      get_buy_range: {
        Args: {
          p_current_price: number
          p_km: number
          p_make: string
          p_model: string
          p_region_id: string
          p_variant_used: string
          p_year: number
        }
        Returns: {
          buy_high: number
          buy_low: number
          match_scope: string
          median_price: number
          position_label: string
          position_note: string
          q1_price: number
          q3_price: number
          sample_count: number
          stretch_high: number
        }[]
      }
      get_buy_window_summary: {
        Args: never
        Returns: {
          assigned: number
          auctions: number
          top_unassigned: Json
          total: number
          traps: number
          unassigned: number
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
      get_due_hunt_scans: {
        Args: { p_limit?: number }
        Returns: {
          dealer_id: string
          geo_mode: string
          hunt_id: string
          include_private: boolean
          km: number
          km_tolerance_pct: number
          make: string
          max_listing_age_days_buy: number
          max_listing_age_days_watch: number
          min_gap_abs_buy: number
          min_gap_abs_watch: number
          min_gap_pct_buy: number
          min_gap_pct_watch: number
          model: string
          proven_exit_value: number
          scan_interval_minutes: number
          sources_enabled: string[]
          states: string[]
          variant_family: string
          year: number
        }[]
      }
      get_fingerprint_v2_adoption: {
        Args: never
        Returns: {
          total: number
          v2: number
          v2_pct: number
        }[]
      }
      get_fingerprints_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      get_home_dashboard: { Args: { p_dealer_id: string }; Returns: Json }
      get_hunt_for_sale: { Args: { p_sale_id: string }; Returns: string }
      get_identities_needing_exit_recompute: {
        Args: never
        Returns: {
          identity_id: string
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
      get_last_equivalent_sale: {
        Args: {
          p_km: number
          p_make: string
          p_model: string
          p_region_id: string
          p_variant_used: string
          p_year: number
        }
        Returns: {
          days_in_stock: number
          km: number
          make: string
          match_scope: string
          model: string
          region_id: string
          sale_date: string
          sale_price: number
          variant_used: string
          year: number
        }[]
      }
      get_last_equivalent_sale_for_spec: {
        Args: { p_dealer_id: string; p_spec_id: string }
        Returns: {
          days_in_stock: number
          km: number
          make: string
          match_scope: string
          model: string
          region_id: string
          sale_date: string
          sale_price: number
          variant_used: string
          year: number
        }[]
      }
      get_last_equivalent_sale_ui: {
        Args: {
          p_km: number
          p_make: string
          p_model: string
          p_region_id: string
          p_variant_used: string
          p_year: number
        }
        Returns: {
          days_in_stock: number
          km: number
          make: string
          match_scope: string
          model: string
          region_id: string
          sale_date: string
          sale_price: number
          variant_used: string
          year: number
        }[]
      }
      get_listings_needing_evaluation:
        | {
            Args: { p_limit?: number }
            Returns: {
              listing_id: string
            }[]
          }
        | {
            Args: { p_limit?: number; p_max_age_hours?: number }
            Returns: {
              listing_id: string
              reason: string
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
      get_pending_spec_match_slack_alerts: {
        Args: never
        Returns: {
          asking_price: number
          benchmark_price: number
          deal_label: string
          dealer_name: string
          delta_pct: number
          km: number
          listing_url: string
          make: string
          match_id: string
          model: string
          region_id: string
          source_class: string
          spec_name: string
          variant_used: string
          year: number
        }[]
      }
      get_price_memory: {
        Args: {
          p_km: number
          p_make: string
          p_model: string
          p_region_id: string
          p_variant_used: string
          p_year: number
        }
        Returns: {
          avg_days_in_stock: number
          last_days_in_stock: number
          last_sale_date: string
          last_sale_price: number
          match_scope: string
          median_price: number
          q1_price: number
          q3_price: number
          sample_count: number
        }[]
      }
      get_sales_sync_health: {
        Args: never
        Returns: {
          latest_sale_date: string
          latest_updated_at: string
          status: string
          sync_freshness_hours: number
          total_rows: number
        }[]
      }
      get_spec_hits_summary: {
        Args: { p_spec_id: string }
        Returns: {
          mispriced_count: number
          no_benchmark_count: number
          strong_buy_count: number
          total_30d: number
          total_7d: number
          watch_count: number
        }[]
      }
      get_stale_dealers: {
        Args: { p_days_threshold?: number }
        Returns: {
          days_stale: number
          dealer_id: string
          dealer_name: string
          has_active_task: boolean
          last_sale_date: string
          total_sales: number
        }[]
      }
      get_today_actions: { Args: never; Returns: Json }
      get_top_drop_reasons: {
        Args: never
        Returns: {
          count: number
          drop_reason: string
        }[]
      }
      get_trap_deals: {
        Args: never
        Returns: {
          asking_price: number
          assigned_at: string
          assigned_to: string
          attempt_count: number
          attempt_stage: string
          avoid_reason: string
          buy_window_at: string
          days_on_market: number
          deal_label: string
          delta_dollars: number
          delta_pct: number
          fingerprint_price: number
          fingerprint_sample: number
          fingerprint_ttd: number
          first_price: number
          first_seen_at: string
          id: string
          km: number
          last_price_change_at: string
          lifecycle_state: string
          listing_id: string
          listing_url: string
          location: string
          make: string
          missing_streak: number
          model: string
          no_benchmark: boolean
          price_change_count: number
          region_id: string
          sold_returned_reason: string
          sold_returned_suspected: boolean
          source: string
          status: string
          tracked_by: string
          variant_family: string
          watch_confidence: string
          watch_reason: string
          watch_status: string
          year: number
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_va_sales_task_queue: {
        Args: never
        Returns: {
          assigned_to: string
          computed_priority: number
          days_since_data: number
          dealer_id: string
          dealer_name: string
          expected_frequency: string
          id: string
          is_overdue: boolean
          last_data_received_at: string
          next_due_at: string
          notes: string
          priority: number
          status: string
          task_type: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_apify_run_progress: {
        Args: {
          p_id: string
          p_items_fetched: number
          p_items_upserted_delta: number
        }
        Returns: undefined
      }
      is_admin_or_internal: { Args: never; Returns: boolean }
      km_band_minmax: {
        Args: { p_km: number }
        Returns: {
          km_max: number
          km_min: number
        }[]
      }
      km_to_band: {
        Args: { p_km: number }
        Returns: {
          km_band_max: number
          km_band_min: number
        }[]
      }
      km_to_profit_band: { Args: { p_km: number }; Returns: string }
      link_cross_posts: {
        Args: { p_confidence?: number; p_listing_ids: string[] }
        Returns: string
      }
      location_to_region: { Args: { p_location: string }; Returns: string }
      map_listing_to_identity: {
        Args: {
          p_drivetrain?: string
          p_fuel?: string
          p_km?: number
          p_make: string
          p_model: string
          p_region_id?: string
          p_transmission?: string
          p_variant_family?: string
          p_year: number
        }
        Returns: string
      }
      mark_listings_delisted: {
        Args: { p_source: string; p_stale_interval?: unknown }
        Returns: number
      }
      mark_spec_matches_slack_sent: {
        Args: { p_match_ids: string[] }
        Returns: number
      }
      mark_stale_listings_delisted:
        | {
            Args: { p_source?: string; p_stale_days?: number }
            Returns: number
          }
        | { Args: { p_stale_days?: number }; Returns: number }
        | {
            Args: { p_source?: string; p_stale_days?: number }
            Returns: number
          }
      match_dealer_specs_for_listing: {
        Args: { p_listing_id: string }
        Returns: {
          deal_label: string
          dealer_spec_id: string
          listing_uuid: string
          match_score: number
          reason: string
        }[]
      }
      materialize_fingerprint_outcomes: {
        Args: { p_asof?: string }
        Returns: {
          records_upserted: number
          regions_processed: number
        }[]
      }
      materialize_fingerprint_profit_stats: {
        Args: never
        Returns: {
          fingerprints_updated: number
        }[]
      }
      reenable_auction_source: {
        Args: { p_reason?: string; p_source_key: string }
        Returns: undefined
      }
      refresh_watch_statuses: {
        Args: never
        Returns: {
          avoid_count: number
          buy_window_count: number
          total_evaluated: number
          watching_count: number
        }[]
      }
      release_pipeline_lock: { Args: never; Returns: undefined }
      rollup_geo_model_metrics_daily: {
        Args: { p_day?: string }
        Returns: {
          records_upserted: number
          regions_updated: number
        }[]
      }
      rpc_classify_hunt: { Args: { p_hunt_id: string }; Returns: Json }
      rpc_classify_listing: { Args: { p_listing_id: string }; Returns: Json }
      rpc_explain_why_listed: {
        Args: { p_dealer_id: string; p_lot_id: string }
        Returns: Json
      }
      rpc_get_auction_lots: {
        Args: {
          p_auction_event_id: string
          p_dealer_id: string
          p_mode?: string
        }
        Returns: Json
      }
      rpc_get_dealer_profile: { Args: { p_dealer_id: string }; Returns: Json }
      rpc_get_today_opportunities: {
        Args: { p_dealer_id: string; p_filters?: Json }
        Returns: Json
      }
      rpc_get_upcoming_auction_cards: {
        Args: { p_dealer_id: string; p_filters?: Json }
        Returns: Json
      }
      rpc_get_watchlist: { Args: { p_dealer_id: string }; Returns: Json }
      run_spec_matching_batch: {
        Args: { p_since_hours?: number }
        Returns: {
          buy_windows_set: number
          listings_checked: number
          matches_created: number
          mispriced: number
          specs_evaluated: number
          strong_buys: number
        }[]
      }
      run_trigger_backfill: {
        Args: { p_batch_size?: number; p_config_version?: string }
        Returns: {
          buy_count: number
          ignore_count: number
          processed: number
          watch_count: number
        }[]
      }
      seller_weight: { Args: { p_seller_type: string }; Returns: number }
      spawn_va_tasks_for_blocked_sources: {
        Args: { p_limit?: number }
        Returns: {
          created_count: number
        }[]
      }
      spawn_va_tasks_for_buy_window: {
        Args: { p_hours?: number }
        Returns: {
          created_count: number
        }[]
      }
      try_acquire_pipeline_lock: { Args: never; Returns: boolean }
      update_auction_attempts: {
        Args: never
        Returns: {
          stage_counts: Json
          updated_count: number
        }[]
      }
      update_autotrader_crawl_cursor: {
        Args: {
          p_cursor_id: string
          p_error?: string
          p_has_more: boolean
          p_listings_found: number
          p_page_crawled: number
        }
        Returns: undefined
      }
      upsert_retail_listing: {
        Args: {
          p_asking_price?: number
          p_km?: number
          p_listing_url: string
          p_make: string
          p_model: string
          p_run_id?: string
          p_source: string
          p_source_listing_id: string
          p_state?: string
          p_suburb?: string
          p_variant_family?: string
          p_variant_raw?: string
          p_year: number
        }
        Returns: Json
      }
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
