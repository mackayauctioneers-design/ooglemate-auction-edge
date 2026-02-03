import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  Eye,
  XCircle,
  ExternalLink,
  Clock,
  MapPin,
  Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface Candidate {
  id: string;
  source: string;
  detail_url: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  state: string | null;
  first_seen_at: string;
  last_seen_at: string;
  crawl_status: string;
  va_notes: string | null;
  reject_reason: string | null;
  account_id: string | null;
}

export default function JoshInboxPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const queryClient = useQueryClient();

  // Action dialogs
  const [actionCandidate, setActionCandidate] = useState<Candidate | null>(null);
  const [actionType, setActionType] = useState<"watch" | "reject" | "alert" | null>(null);
  const [notes, setNotes] = useState("");
  const [alertReason, setAlertReason] = useState("");

  // Set default account when loaded (in useEffect to avoid render-loop)
  useEffect(() => {
    if (selectedAccountId) return;
    if (!accounts?.length) return;
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setSelectedAccountId(mackay?.id ?? accounts[0].id);
  }, [accounts, selectedAccountId]);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["josh-inbox", selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      const { data, error } = await supabase
        .from("pickles_detail_queue")
        .select("*")
        .eq("account_id", selectedAccountId)
        .in("source", ["grok_search", "grok_watch", "manual_watch"])
        .eq("crawl_status", "pending")
        .order("first_seen_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Candidate[];
    },
    enabled: !!selectedAccountId,
  });

  const updateCandidateMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
      rejectReason,
    }: {
      id: string;
      status: string;
      notes?: string;
      rejectReason?: string;
    }) => {
      const update: Record<string, any> = {
        crawl_status: status,
        validated_at: status === "validated" ? new Date().toISOString() : null,
        validated_by: status === "validated" ? "josh" : null,
      };
      if (notes) update.va_notes = notes;
      if (rejectReason) update.reject_reason = rejectReason;

      const { error } = await supabase
        .from("pickles_detail_queue")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["josh-inbox"] });
      toast.success("Candidate updated");
      closeDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const sendAlertMutation = useMutation({
    mutationFn: async ({
      candidate,
      reason,
    }: {
      candidate: Candidate;
      reason: string;
    }) => {
      const { error } = await supabase.from("josh_alerts").insert({
        account_id: selectedAccountId,
        created_by: "josh",
        candidate_queue_id: candidate.id,
        url: candidate.detail_url,
        title: `${candidate.year || ""} ${candidate.make || ""} ${candidate.model || ""}`.trim(),
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert sent to Dave");
      closeDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const closeDialog = () => {
    setActionCandidate(null);
    setActionType(null);
    setNotes("");
    setAlertReason("");
  };

  const handleAction = (candidate: Candidate, type: "validate" | "watch" | "reject" | "alert") => {
    if (type === "validate") {
      updateCandidateMutation.mutate({ id: candidate.id, status: "validated" });
    } else {
      setActionCandidate(candidate);
      setActionType(type);
    }
  };

  const submitAction = () => {
    if (!actionCandidate) return;

    if (actionType === "watch") {
      if (!notes.trim()) {
        toast.error("Notes are required for Watch");
        return;
      }
      updateCandidateMutation.mutate({
        id: actionCandidate.id,
        status: "watch",
        notes: notes.trim(),
      });
    } else if (actionType === "reject") {
      if (!notes.trim()) {
        toast.error("Reject reason is required");
        return;
      }
      updateCandidateMutation.mutate({
        id: actionCandidate.id,
        status: "rejected",
        rejectReason: notes.trim(),
      });
    } else if (actionType === "alert") {
      if (!alertReason.trim()) {
        toast.error("Reason is required");
        return;
      }
      sendAlertMutation.mutate({
        candidate: actionCandidate,
        reason: alertReason.trim(),
      });
    }
  };

  const getSourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      grok_search: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      grok_watch: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      manual_watch: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    };
    return colors[source] || "bg-muted";
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Josh Inbox</h1>
            <p className="text-muted-foreground">
              Review candidates from Grok and watchlist scans
            </p>
          </div>
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !candidates?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">Inbox Clear</h3>
              <p className="text-muted-foreground max-w-md mt-1">
                No pending candidates. Run a Grok mission or add watchlist URLs to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {candidates.map((candidate) => (
              <Card key={candidate.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getSourceBadge(candidate.source)}>
                          {candidate.source.replace("_", " ")}
                        </Badge>
                        <h3 className="font-semibold">
                          {candidate.year || "?"} {candidate.make || "Unknown"}{" "}
                          {candidate.model || ""}
                        </h3>
                        {candidate.variant_raw && (
                          <span className="text-sm text-muted-foreground">
                            {candidate.variant_raw}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {candidate.km && (
                          <span>{(candidate.km / 1000).toFixed(0)}k km</span>
                        )}
                        {candidate.asking_price && (
                          <span className="font-medium text-foreground">
                            ${candidate.asking_price.toLocaleString()}
                          </span>
                        )}
                        {(candidate.location || candidate.state) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {candidate.location || candidate.state}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(candidate.first_seen_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>

                      {candidate.detail_url && (
                        <a
                          href={candidate.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                          View Listing
                        </a>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleAction(candidate, "validate")}
                        disabled={updateCandidateMutation.isPending}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(candidate, "watch")}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Watch
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(candidate, "reject")}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleAction(candidate, "alert")}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Dave
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Action Dialog */}
      <Dialog open={!!actionType} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "watch" && "Add to Watch"}
              {actionType === "reject" && "Reject Candidate"}
              {actionType === "alert" && "Send to Dave"}
            </DialogTitle>
          </DialogHeader>

          {actionCandidate && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <span className="font-medium">
                  {actionCandidate.year} {actionCandidate.make} {actionCandidate.model}
                </span>
                {actionCandidate.asking_price && (
                  <span className="ml-2 text-muted-foreground">
                    ${actionCandidate.asking_price.toLocaleString()}
                  </span>
                )}
              </div>

              {actionType === "alert" ? (
                <div>
                  <label className="text-sm font-medium">Reason for Dave</label>
                  <Textarea
                    value={alertReason}
                    onChange={(e) => setAlertReason(e.target.value)}
                    placeholder="Why is this a good opportunity?"
                    className="mt-1"
                    rows={3}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">
                    {actionType === "watch" ? "Notes" : "Reject Reason"}
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      actionType === "watch"
                        ? "Why are you watching this?"
                        : "Why are you rejecting this?"
                    }
                    className="mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={submitAction}
              disabled={
                updateCandidateMutation.isPending || sendAlertMutation.isPending
              }
            >
              {actionType === "alert" ? "Send Alert" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
