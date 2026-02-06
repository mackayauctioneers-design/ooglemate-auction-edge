import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useDealDetail, DealStatus } from "@/hooks/useDeals";
import { useAuth } from "@/contexts/AuthContext";
import { DealTimeline } from "@/components/deals/DealTimeline";
import { DealArtefactsPanel } from "@/components/deals/DealArtefactsPanel";
import { DealStatusActions } from "@/components/deals/DealStatusActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  ExternalLink,
  ArrowLeft,
  Target,
  MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function DealDetailPage() {
  useDocumentTitle(0);
  const { dealId } = useParams<{ dealId: string }>();
  const { currentUser } = useAuth();
  const { deal, events, artefacts, loading, refetch } = useDealDetail(dealId || "");
  const [note, setNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const createdBy = currentUser?.email || currentUser?.dealer_name || "unknown";

  const hasInvoice = artefacts.some((a) =>
    ["auction_invoice", "tax_invoice", "buyer_fees_invoice", "payment_receipt"].includes(a.artefact_type)
  );

  const handleAddNote = async () => {
    if (!note.trim() || !dealId) return;
    setAddingNote(true);
    try {
      await supabase.from("deal_truth_events").insert({
        deal_id: dealId,
        event_type: "note_added",
        event_payload: { note: note.trim() },
        created_by: createdBy,
      });
      setNote("");
      toast.success("Note added");
      refetch();
    } catch {
      toast.error("Failed to add note");
    } finally {
      setAddingNote(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!deal) {
    return (
      <AppLayout>
        <div className="p-6 text-center">
          <h2 className="text-lg font-medium">Deal not found</h2>
          <Link to="/deals">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Deals
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
        {/* Back link */}
        <Link to="/deals" className="text-sm text-primary hover:underline flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to Deal Ledger
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              {deal.year} {deal.make} {deal.model}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className="capitalize text-xs">
                {deal.source}
              </Badge>
              {deal.vehicle_identifier && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {deal.vehicle_identifier}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                Created {format(new Date(deal.created_at), "dd MMM yyyy HH:mm")}
              </span>
            </div>
            <a
              href={deal.url_canonical}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
            >
              View listing <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Status actions */}
          <DealStatusActions
            dealId={deal.id}
            status={deal.status as DealStatus}
            createdBy={createdBy}
            onStatusChange={refetch}
            hasInvoice={hasInvoice}
          />
        </div>

        {/* Vehicle info cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-lg font-bold">
                {deal.asking_price ? `$${deal.asking_price.toLocaleString()}` : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">Asking Price</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-lg font-bold">
                {deal.km ? `${Math.round(deal.km / 1000)}k km` : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">Kilometres</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-lg font-bold">{deal.year || "—"}</div>
              <div className="text-[10px] text-muted-foreground">Year</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-lg font-bold">{events.length}</div>
              <div className="text-[10px] text-muted-foreground">Events</div>
            </CardContent>
          </Card>
        </div>

        {/* Why matched block */}
        {events.length > 0 && events[0].event_type === "identified" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Why This Matched
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const payload = events[0].event_payload as Record<string, unknown>;
                const reasons = payload.reasons as Record<string, string> | undefined;
                if (!reasons) return <p className="text-sm text-muted-foreground">No match data.</p>;
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(reasons).map(([k, v]) => (
                      <Badge
                        key={k}
                        variant={v.includes("(+") && !v.includes("(+0)") ? "secondary" : "outline"}
                        className="text-xs"
                      >
                        {v}
                      </Badge>
                    ))}
                  </div>
                );
              })()}
              {events[0].event_payload && (events[0].event_payload as Record<string, unknown>).match_score && (
                <p className="text-xs text-muted-foreground mt-2">
                  Match score: {String((events[0].event_payload as Record<string, unknown>).match_score)}/100
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Timeline */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Event Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <DealTimeline events={events} />

              {/* Add note */}
              <div className="mt-4 space-y-2 border-t pt-4">
                <Textarea
                  placeholder="Add a note to this deal…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  disabled={!note.trim() || addingNote}
                  onClick={handleAddNote}
                >
                  {addingNote ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <MessageSquare className="h-4 w-4 mr-1" />
                  )}
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Artefacts */}
          <DealArtefactsPanel
            dealId={deal.id}
            accountId={deal.account_id}
            dealStatus={deal.status as DealStatus}
            artefacts={artefacts}
            onUploaded={refetch}
            createdBy={createdBy}
          />
        </div>

        <p className="text-xs text-muted-foreground text-center py-2">
          This deal record is an audit trail. Events and documents are append-only and timestamped.
        </p>
      </div>
    </AppLayout>
  );
}
