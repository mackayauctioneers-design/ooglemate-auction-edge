import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface OogleBotJob {
  id: string;
  dealer_name: string;
  dealer_contact: string | null;
  make: string;
  model: string;
  variant: string | null;
  year_min: number;
  year_max: number;
  km_max: number;
  budget_ceiling: number;
  urgency: "normal" | "high" | "urgent";
  status: "active" | "fulfilled" | "expired" | "paused";
  expiry_date: string;
  created_at: string;
  created_by: string;
  last_match_at: string | null;
  notes: string | null;
}

export interface OogleBotMatch {
  id: string;
  ooglebot_job_id: string;
  listing_id: string;
  source: string;
  effective_cost: number;
  ask_price: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  location: string | null;
  listing_url: string | null;
  days_listed: number | null;
  rank_position: number;
  created_at: string;
}

export function useOogleBotJobs() {
  return useQuery({
    queryKey: ["ooglebot-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ooglebot_jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as OogleBotJob[];
    },
  });
}

export function useOogleBotMatches(jobId: string | null) {
  return useQuery({
    queryKey: ["ooglebot-matches", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ooglebot_matches")
        .select("*")
        .eq("ooglebot_job_id", jobId!)
        .order("rank_position");
      if (error) throw error;
      return data as OogleBotMatch[];
    },
  });
}

export function useCreateOogleBotJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: Omit<OogleBotJob, "id" | "created_at" | "last_match_at" | "status" | "expiry_date">) => {
      const { data, error } = await supabase
        .from("ooglebot_jobs")
        .insert(job)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ooglebot-jobs"] });
      toast.success("OogleBot job created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OogleBotJob["status"] }) => {
      const { error } = await supabase
        .from("ooglebot_jobs")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ooglebot-jobs"] });
      toast.success("Job status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
