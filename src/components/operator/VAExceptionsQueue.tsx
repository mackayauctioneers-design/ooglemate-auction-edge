import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Check, X, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface VAException {
  id: string;
  stub_anchor_id: string | null;
  url: string;
  source: string;
  missing_fields: string[];
  reason: string;
  error_details: string | null;
  status: string;
  priority: string;
  created_at: string;
  resolved_data: Record<string, unknown> | null;
  resolution_notes: string | null;
}

export function VAExceptionsQueue() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveData, setResolveData] = useState<{
    stockId?: string;
    year?: string;
    make?: string;
    model?: string;
    km?: string;
    notes?: string;
  }>({});

  const { data: exceptions, isLoading, refetch } = useQuery({
    queryKey: ["va-exceptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("va_exceptions")
        .select("*")
        .in("status", ["pending", "assigned"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(50);
      
      if (error) throw error;
      return data as VAException[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, action, data }: { 
      id: string; 
      action: "complete" | "reject"; 
      data?: Record<string, unknown> 
    }) => {
      const updates: Record<string, unknown> = {
        status: action === "complete" ? "completed" : "rejected",
        completed_at: new Date().toISOString(),
        completed_by: "operator",
      };
      
      if (data) {
        updates.resolved_data = data;
        updates.resolution_notes = data.notes as string || null;
      }

      const { error } = await supabase
        .from("va_exceptions")
        .update(updates)
        .eq("id", id);
      
      if (error) throw error;

      // If completing with data, update the stub_anchor
      if (action === "complete" && data) {
        const exception = exceptions?.find(e => e.id === id);
        if (exception?.stub_anchor_id) {
          await supabase
            .from("stub_anchors")
            .update({
              source_stock_id: data.stockId as string || null,
              year: data.year ? parseInt(data.year as string) : null,
              make: data.make as string || null,
              model: data.model as string || null,
              km: data.km ? parseInt(data.km as string) : null,
              status: "pending", // Re-queue for matching
              confidence: "high",
            })
            .eq("id", exception.stub_anchor_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["va-exceptions"] });
      setSelectedId(null);
      setResolveData({});
      toast.success("Exception resolved");
    },
    onError: (error) => {
      toast.error(`Failed to resolve: ${error.message}`);
    },
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-red-500";
      case "high": return "bg-orange-500";
      case "normal": return "bg-blue-500";
      default: return "bg-muted";
    }
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading exceptions...</div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          VA Exception Queue
          <Badge variant="outline">{exceptions?.length || 0}</Badge>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {exceptions?.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending exceptions</p>
        ) : (
          exceptions?.map((exc) => (
            <div key={exc.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={getPriorityColor(exc.priority)}>
                      {exc.priority}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(exc.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate">{exc.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Missing: {exc.missing_fields.join(", ")}
                  </p>
                </div>
                <a
                  href={exc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              {selectedId === exc.id ? (
                <div className="space-y-2 pt-2 border-t">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Stock ID"
                      value={resolveData.stockId || ""}
                      onChange={(e) => setResolveData({ ...resolveData, stockId: e.target.value })}
                    />
                    <Input
                      placeholder="Year"
                      value={resolveData.year || ""}
                      onChange={(e) => setResolveData({ ...resolveData, year: e.target.value })}
                    />
                    <Input
                      placeholder="Make"
                      value={resolveData.make || ""}
                      onChange={(e) => setResolveData({ ...resolveData, make: e.target.value })}
                    />
                    <Input
                      placeholder="Model"
                      value={resolveData.model || ""}
                      onChange={(e) => setResolveData({ ...resolveData, model: e.target.value })}
                    />
                    <Input
                      placeholder="KM"
                      value={resolveData.km || ""}
                      onChange={(e) => setResolveData({ ...resolveData, km: e.target.value })}
                    />
                  </div>
                  <Textarea
                    placeholder="Notes..."
                    value={resolveData.notes || ""}
                    onChange={(e) => setResolveData({ ...resolveData, notes: e.target.value })}
                    className="h-16"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => resolveMutation.mutate({ 
                        id: exc.id, 
                        action: "complete", 
                        data: resolveData 
                      })}
                      disabled={resolveMutation.isPending}
                    >
                      <Check className="h-3 w-3 mr-1" /> Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => resolveMutation.mutate({ id: exc.id, action: "reject" })}
                      disabled={resolveMutation.isPending}
                    >
                      <X className="h-3 w-3 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedId(null);
                        setResolveData({});
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedId(exc.id)}
                >
                  Resolve
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
