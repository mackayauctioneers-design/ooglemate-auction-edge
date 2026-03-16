import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface StarVehiclePayload {
  listing_id: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  km?: number | null;
  asking_price?: number | null;
  source?: string | null;
  source_url?: string | null;
  variant?: string | null;
  location?: string | null;
}

/**
 * Universal star hook — upserts into operator_opportunities with is_starred = true.
 * Works from any page (OogleBot, Finds, etc.) and surfaces in Trading Desk.
 */
export function useStarVehicle() {
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const toggleStar = useCallback(async (vehicle: StarVehiclePayload) => {
    const lid = vehicle.listing_id;
    if (!lid) return;

    setLoading((prev) => new Set(prev).add(lid));

    try {
      // Check if opportunity already exists
      const { data: existing } = await supabase
        .from("operator_opportunities")
        .select("id, is_starred")
        .eq("listing_id", lid)
        .maybeSingle();

      if (existing) {
        // Toggle star on existing row
        const newVal = !existing.is_starred;
        const { error } = await supabase
          .from("operator_opportunities")
          .update({ is_starred: newVal, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;

        setStarredIds((prev) => {
          const next = new Set(prev);
          newVal ? next.add(lid) : next.delete(lid);
          return next;
        });
        toast.success(newVal ? "⭐ Starred — visible in Trading Desk" : "Unstarred");
      } else {
        // Create new opportunity row with star
        const { error } = await supabase
          .from("operator_opportunities")
          .insert({
            listing_id: lid,
            make: vehicle.make?.toUpperCase() || null,
            model: vehicle.model?.toUpperCase() || null,
            year: vehicle.year || null,
            km: vehicle.km || null,
            asking_price: vehicle.asking_price || null,
            listing_source: vehicle.source || "ooglebot_star",
            source_url: vehicle.source_url || null,
            variant: vehicle.variant || null,
            tier: "WATCH",
            status: "new",
            is_starred: true,
          });
        if (error) throw error;

        setStarredIds((prev) => new Set(prev).add(lid));
        toast.success("⭐ Starred — added to Trading Desk");
      }
    } catch (err: any) {
      console.error("[useStarVehicle]", err);
      toast.error("Failed to star vehicle");
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(lid);
        return next;
      });
    }
  }, []);

  const isStarred = useCallback((lid: string) => starredIds.has(lid), [starredIds]);
  const isLoading = useCallback((lid: string) => loading.has(lid), [loading]);

  // Bulk-check which listing_ids are already starred (call once on mount)
  const checkStarred = useCallback(async (listingIds: string[]) => {
    if (!listingIds.length) return;
    const { data } = await supabase
      .from("operator_opportunities")
      .select("listing_id")
      .in("listing_id", listingIds.slice(0, 200))
      .eq("is_starred", true);
    if (data) {
      setStarredIds(new Set(data.map((d) => d.listing_id)));
    }
  }, []);

  return { toggleStar, isStarred, isLoading, checkStarred };
}
