import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface FingerprintTarget {
  id: string;
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  transmission: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  body_type: string | null;
  median_profit: number | null;
  median_profit_pct: number | null;
  median_days_to_clear: number | null;
  median_sale_price: number | null;
  median_km: number | null;
  total_sales: number;
  confidence_level: string;
  spec_completeness: number;
  target_score: number;
  origin: string;
  status: string;
  source_candidate_id: string | null;
  last_promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useBuyAgainTargets(accountId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["buy-again-targets", accountId];

  const { data: targets, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fingerprint_targets")
        .select("*")
        .eq("account_id", accountId)
        .in("status", ["candidate", "active", "paused"])
        .order("target_score", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as FingerprintTarget[];
    },
    enabled: !!accountId,
  });

  // Seed from sales_target_candidates if no targets exist
  const seedMutation = useMutation({
    mutationFn: async () => {
      // Check if non-retired targets already exist
      const { count } = await supabase
        .from("fingerprint_targets")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .in("status", ["candidate", "active", "paused"]);

      if (count && count > 0) {
        return { seeded: 0, message: "Targets already exist — use Clear & Re-Seed to refresh" };
      }

      return await doSeed();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data.seeded > 0) {
        toast.success(`Seeded ${data.seeded} targets from sales history`);
      } else {
        toast.info(data.message || "No new targets to seed");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Clear & Re-Seed: retire all existing, then seed fresh
  const clearAndReseedMutation = useMutation({
    mutationFn: async () => {
      // Retire all non-retired targets for this account
      const { data: retired, error: rErr } = await supabase
        .from("fingerprint_targets")
        .update({ status: "retired" })
        .eq("account_id", accountId)
        .in("status", ["candidate", "active", "paused"])
        .select("id");
      if (rErr) throw rErr;
      const retiredCount = retired?.length || 0;

      const result = await doSeed();
      return { ...result, retiredCount };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(
        `Cleared ${data.retiredCount} old targets, seeded ${data.seeded} fresh`
      );
    },
    onError: (err: any) => toast.error(err.message),
  });

  async function doSeed() {
    // Pull from sales_target_candidates
    const { data: candidates, error: cErr } = await supabase
      .from("sales_target_candidates")
      .select("*")
      .eq("account_id", accountId)
      .in("status", ["candidate", "active"])
      .order("target_score", { ascending: false })
      .limit(30);

    if (cErr) throw cErr;
    if (!candidates?.length) return { seeded: 0, message: "No candidates found in sales data" };

    const rows = candidates.map((c: any) => ({
      account_id: accountId,
      make: c.make,
      model: c.model,
      variant: c.variant,
      transmission: c.transmission,
      fuel_type: c.fuel_type,
      drive_type: c.drive_type,
      body_type: c.body_type,
      median_profit: c.median_profit,
      median_profit_pct: c.median_profit_pct,
      median_days_to_clear: c.median_days_to_clear,
      median_sale_price: c.median_sale_price,
      median_km: c.median_km,
      total_sales: c.sales_count,
      confidence_level: c.confidence_level?.toUpperCase() || "LOW",
      spec_completeness: c.spec_completeness || 0,
      target_score: c.target_score || 0,
      origin: "sales_truth" as const,
      status: "candidate" as const,
      source_candidate_id: c.id,
    }));

    const { error: iErr } = await supabase
      .from("fingerprint_targets")
      .insert(rows);
    if (iErr) throw iErr;

    return { seeded: rows.length };
  }

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === "active") update.last_promoted_at = new Date().toISOString();
      const { error } = await supabase
        .from("fingerprint_targets")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const candidates = (targets || []).filter((t) => t.status === "candidate");
  const active = (targets || []).filter((t) => t.status === "active");
  const paused = (targets || []).filter((t) => t.status === "paused");

  return {
    candidates,
    active,
    paused,
    isLoading,
    seed: seedMutation.mutate,
    isSeeding: seedMutation.isPending,
    clearAndReseed: clearAndReseedMutation.mutate,
    isClearing: clearAndReseedMutation.isPending,
    promote: (id: string) => updateStatus.mutate({ id, status: "active" }),
    dismiss: (id: string) => updateStatus.mutate({ id, status: "retired" }),
    pause: (id: string) => updateStatus.mutate({ id, status: "paused" }),
    retire: (id: string) => updateStatus.mutate({ id, status: "retired" }),
    reactivate: (id: string) => updateStatus.mutate({ id, status: "active" }),
  };
}
