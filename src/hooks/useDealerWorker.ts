import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type WorkerAction =
  | "activate-dealer"
  | "run-dealer-scoring"
  | "sync-opportunities"
  | "dealer-health";

interface DispatchResult {
  ok: boolean;
  run_id?: string;
  worker_response?: unknown;
  error?: string;
}

async function invokeWorker(action: WorkerAction, dealerId: string, body: Record<string, unknown> = {}) {
  if (!dealerId) throw new Error("dealer_id is required");
  const { data, error } = await supabase.functions.invoke(action, {
    body: { ...body, dealer_id: dealerId },
  });
  if (error) throw error;
  return data as DispatchResult;
}

export function useActivateDealer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealerId: string) => invokeWorker("activate-dealer", dealerId),
    onSuccess: (_d, dealerId) => {
      toast.success("Dealer activation dispatched");
      qc.invalidateQueries({ queryKey: ["worker-runs", dealerId] });
    },
    onError: (e: Error) => toast.error(e.message || "Activation failed"),
  });
}

export function useRunDealerScoring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealerId: string) => invokeWorker("run-dealer-scoring", dealerId),
    onSuccess: (_d, dealerId) => {
      toast.success("Scoring run dispatched");
      qc.invalidateQueries({ queryKey: ["worker-runs", dealerId] });
    },
    onError: (e: Error) => toast.error(e.message || "Scoring failed"),
  });
}

export function useSyncOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealerId: string) => invokeWorker("sync-opportunities", dealerId),
    onSuccess: (_d, dealerId) => {
      toast.success("Opportunity sync dispatched");
      qc.invalidateQueries({ queryKey: ["worker-runs", dealerId] });
    },
    onError: (e: Error) => toast.error(e.message || "Sync failed"),
  });
}

export function useDealerHealth(dealerId: string | null | undefined) {
  return useQuery({
    queryKey: ["dealer-health", dealerId],
    enabled: !!dealerId,
    queryFn: async () => {
      if (!dealerId) return null;
      return invokeWorker("dealer-health", dealerId);
    },
  });
}

export function useWorkerRuns(dealerId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ["worker-runs", dealerId],
    enabled: !!dealerId,
    queryFn: async () => {
      if (!dealerId) return [];
      const { data, error } = await supabase
        .from("worker_runs")
        .select("id, action, status, http_status, error, duration_ms, started_at, finished_at")
        .eq("dealer_id", dealerId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}
