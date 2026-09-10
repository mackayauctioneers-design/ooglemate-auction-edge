import { useEffect, useMemo } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Radio, Building2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAgentConduit, agentHealth, AgentRow } from "@/hooks/useAgentConduit";
import { useAccounts } from "@/hooks/useAccounts";

const HEALTH_STYLES: Record<string, string> = {
  live: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  late: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  error: "bg-destructive/20 text-destructive border-destructive/30",
  never: "bg-muted text-muted-foreground",
};
const HEALTH_LABEL: Record<string, string> = {
  live: "Live", late: "Overdue", error: "Problem", never: "Never checked in",
};

function HealthBadge({ agent }: { agent: AgentRow }) {
  const h = agentHealth(agent);
  return (
    <Badge className={`text-xs ${HEALTH_STYLES[h]}`}>
      <Radio className="h-3 w-3 mr-1" />
      {HEALTH_LABEL[h]}
    </Badge>
  );
}

export default function AgentConduitPage() {
  useEffect(() => { document.title = "Agent Conduit | Carbitrage"; }, []);

  const { data, isLoading } = useAgentConduit();
  const { data: accounts } = useAccounts();

  const agents = data?.agents ?? [];
  const links = data?.links ?? [];

  const accountName = useMemo(() => {
    const m = new Map<string, string>();
    (accounts ?? []).forEach((a) => m.set(a.id, a.display_name));
    return m;
  }, [accounts]);

  const byDealer = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof links }>();
    links.forEach((l) => {
      const key = l.account_id ?? l.dealer_slug ?? "unassigned";
      const name = (l.account_id && accountName.get(l.account_id)) || l.dealer_slug || "Unassigned / market-wide";
      if (!map.has(key)) map.set(key, { name, rows: [] });
      map.get(key)!.rows.push(l);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [links, accountName]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const liveCount = agents.filter((a) => agentHealth(a) === "live").length;

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" /> Agent Conduit
          </h1>
          <p className="text-muted-foreground">
            Every agent connected to this site, what it watches, and when it last reported in.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Agents registered", value: agents.length },
            { label: "Live now", value: liveCount },
            { label: "Watch links", value: links.length },
            { label: "Dealerships covered", value: new Set(links.filter(l => l.account_id).map(l => l.account_id)).size },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agents…
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Agents</CardTitle></CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No agents have checked in yet. Point each agent at the check-in endpoint and it will appear here.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last check-in</TableHead>
                    <TableHead className="text-right">Watching</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-medium">{a.display_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.agent_key}</div>
                        {a.last_error && <div className="text-xs text-destructive mt-1">{a.last_error}</div>}
                      </TableCell>
                      <TableCell className="capitalize">{a.kind}</TableCell>
                      <TableCell>{a.owner ?? "—"}</TableCell>
                      <TableCell><HealthBadge agent={a} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.last_seen_at ? formatDistanceToNow(new Date(a.last_seen_at), { addSuffix: true }) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {links.filter((l) => l.agent_id === a.id).length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Coverage by dealership
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {byDealer.length === 0 && (
              <p className="text-sm text-muted-foreground">No dealership coverage recorded yet.</p>
            )}
            {byDealer.map((group) => (
              <div key={group.name} className="rounded-lg border border-border p-3">
                <div className="font-medium mb-2">{group.name}</div>
                <div className="space-y-1.5">
                  {group.rows.map((l) => {
                    const agent = agentById.get(l.agent_id);
                    return (
                      <div key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-xs">{agent?.display_name ?? "Unknown agent"}</Badge>
                        <span className="text-muted-foreground">
                          {l.label || `${l.watch_type}${l.target_ref ? `: ${l.target_ref}` : ""}`}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {l.last_run_at ? formatDistanceToNow(new Date(l.last_run_at), { addSuffix: true }) : "no runs"}
                          {l.items_last_run != null ? ` · ${l.items_last_run} items` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
