import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle,
  XCircle,
  ExternalLink,
  Clock,
  User,
  Inbox,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface Alert {
  id: string;
  account_id: string;
  created_by: string;
  candidate_queue_id: string | null;
  url: string | null;
  title: string | null;
  reason: string;
  status: string;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

export default function DaveInboxPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [filter, setFilter] = useState<"open" | "handled" | "all">("open");
  const queryClient = useQueryClient();

  // Set default account when loaded
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["dave-inbox", selectedAccountId, filter],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      let query = supabase
        .from("josh_alerts")
        .select("*")
        .eq("account_id", selectedAccountId)
        .order("created_at", { ascending: false });

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Alert[];
    },
    enabled: !!selectedAccountId,
  });

  const handleAlertMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "handled" | "dismissed";
    }) => {
      const { error } = await supabase
        .from("josh_alerts")
        .update({
          status,
          handled_by: "dave",
          handled_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dave-inbox"] });
      toast.success("Alert updated");
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      open: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      handled: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      dismissed: "bg-muted text-muted-foreground",
    };
    return colors[status] || "bg-muted";
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Inbox className="h-6 w-6" />
              Dave's Inbox
            </h1>
            <p className="text-muted-foreground">
              Opportunities escalated by Josh
            </p>
          </div>
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        <div className="flex gap-2">
          {(["open", "handled", "all"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !alerts?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">
                {filter === "open" ? "No open alerts" : "No alerts found"}
              </h3>
              <p className="text-muted-foreground max-w-md mt-1">
                {filter === "open"
                  ? "Josh hasn't sent any new opportunities yet."
                  : "No alerts match the current filter."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {alerts.map((alert) => (
              <Card key={alert.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getStatusBadge(alert.status)}>
                          {alert.status}
                        </Badge>
                        {alert.title && (
                          <h3 className="font-semibold">{alert.title}</h3>
                        )}
                      </div>

                      <p className="text-sm">{alert.reason}</p>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          From {alert.created_by}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(alert.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                        {alert.handled_at && (
                          <span>
                            Handled by {alert.handled_by}{" "}
                            {formatDistanceToNow(new Date(alert.handled_at), {
                              addSuffix: true,
                            })}
                          </span>
                        )}
                      </div>

                      {alert.url && (
                        <a
                          href={alert.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View Listing
                        </a>
                      )}
                    </div>

                    {alert.status === "open" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() =>
                            handleAlertMutation.mutate({
                              id: alert.id,
                              status: "handled",
                            })
                          }
                          disabled={handleAlertMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Handle
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            handleAlertMutation.mutate({
                              id: alert.id,
                              status: "dismissed",
                            })
                          }
                          disabled={handleAlertMutation.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
