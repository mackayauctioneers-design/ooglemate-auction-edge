import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Radio } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAgentsWatchingAccount, agentHealth } from "@/hooks/useAgentConduit";

const HEALTH_STYLES: Record<string, string> = {
  live: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  late: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  error: "bg-destructive/20 text-destructive border-destructive/30",
  never: "bg-muted text-muted-foreground",
};

export function AgentsWatchingCard() {
  const { user } = useAuth();

  const { data: accountId } = useQuery({
    queryKey: ["my-account-id", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("dealer_profiles")
        .select("account_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data?.account_id ?? null;
    },
  });

  const { data } = useAgentsWatchingAccount(accountId);
  const agents = data?.agents ?? [];
  const links = data?.links ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          Watching for you
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {agents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No agents are linked to your dealership yet.
          </p>
        )}
        {agents.map((agent) => {
          const health = agentHealth(agent);
          const mine = links.filter((l) => l.agent_id === agent.id);
          return (
            <div key={agent.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{agent.display_name}</span>
                <Badge className={`text-xs ${HEALTH_STYLES[health]}`}>
                  <Radio className="h-3 w-3 mr-1" />
                  {health === "live" ? "Live" : health === "late" ? "Overdue" : health === "error" ? "Problem" : "Not started"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {agent.last_seen_at
                  ? `Last checked in ${formatDistanceToNow(new Date(agent.last_seen_at), { addSuffix: true })}`
                  : "Has not checked in yet"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mine.map((l) => (
                  <Badge key={l.id} variant="secondary" className="text-[11px]">
                    {l.label || `${l.watch_type}${l.target_ref ? `: ${l.target_ref}` : ""}`}
                    {l.items_last_run != null ? ` · ${l.items_last_run}` : ""}
                  </Badge>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
