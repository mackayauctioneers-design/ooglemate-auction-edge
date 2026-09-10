import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgentRow {
  id: string;
  agent_key: string;
  display_name: string;
  kind: string;
  description: string | null;
  owner: string | null;
  endpoint: string | null;
  capabilities: unknown;
  is_active: boolean;
  expected_interval_minutes: number;
  last_seen_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface WatchLinkRow {
  id: string;
  agent_id: string;
  account_id: string | null;
  dealer_slug: string | null;
  watch_type: string;
  target_ref: string;
  label: string | null;
  status: string;
  last_run_at: string | null;
  last_success_at: string | null;
  items_last_run: number | null;
}

export type AgentHealth = "live" | "late" | "error" | "never";

export function agentHealth(agent: AgentRow): AgentHealth {
  if (!agent.last_seen_at) return "never";
  if (agent.last_status && agent.last_status !== "ok") return "error";
  const ageMin = (Date.now() - new Date(agent.last_seen_at).getTime()) / 60000;
  return ageMin > agent.expected_interval_minutes * 2 ? "late" : "live";
}

/** Full registry + every watch link — operator view. */
export function useAgentConduit() {
  return useQuery({
    queryKey: ["agent-conduit"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [agentsRes, linksRes] = await Promise.all([
        supabase.from("agent_registry").select("*").order("display_name"),
        supabase.from("agent_watch_links").select("*").order("last_run_at", { ascending: false }),
      ]);
      if (agentsRes.error) throw agentsRes.error;
      if (linksRes.error) throw linksRes.error;
      return {
        agents: (agentsRes.data ?? []) as unknown as AgentRow[],
        links: (linksRes.data ?? []) as unknown as WatchLinkRow[],
      };
    },
  });
}

/** Agents watching one dealership — dealer-facing view. */
export function useAgentsWatchingAccount(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ["agents-watching", accountId],
    enabled: !!accountId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("agent_watch_links")
        .select("*")
        .eq("account_id", accountId!)
        .order("last_run_at", { ascending: false });
      if (error) throw error;
      const rows = (links ?? []) as unknown as WatchLinkRow[];
      const ids = [...new Set(rows.map((l) => l.agent_id))];
      if (!ids.length) return { agents: [] as AgentRow[], links: rows };
      const { data: agents, error: aErr } = await supabase
        .from("agent_registry")
        .select("*")
        .in("id", ids);
      if (aErr) throw aErr;
      return { agents: (agents ?? []) as unknown as AgentRow[], links: rows };
    },
  });
}
