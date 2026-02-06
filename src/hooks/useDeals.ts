import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Deal {
  id: string;
  account_id: string;
  source: string;
  url_canonical: string;
  listing_norm_id: string | null;
  matched_opportunity_id: string | null;
  vehicle_identifier: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  status: string;
  created_at: string;
  created_by: string;
  notes: string | null;
}

export interface DealEvent {
  id: string;
  deal_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: string;
  created_by: string;
}

export interface DealArtefact {
  id: string;
  deal_id: string;
  artefact_type: string;
  file_url: string;
  file_hash: string;
  mime_type: string;
  created_at: string;
  created_by: string;
}

export type DealStatus = "identified" | "approved" | "purchased" | "delivered" | "closed" | "aborted";

const STATUS_ORDER: DealStatus[] = ["identified", "approved", "purchased", "delivered", "closed"];

const ALLOWED_ARTEFACT_TYPES: Record<DealStatus, string[]> = {
  identified: ["listing_snapshot", "arrival_photos", "other"],
  approved: ["listing_snapshot", "arrival_photos", "other"],
  purchased: ["auction_invoice", "tax_invoice", "buyer_fees_invoice", "payment_receipt", "other"],
  delivered: ["transport_invoice", "arrival_photos", "condition_report", "other"],
  closed: ["other"],
  aborted: ["other"],
};

export function getAllowedArtefactTypes(status: DealStatus): string[] {
  return ALLOWED_ARTEFACT_TYPES[status] || ["other"];
}

export function getNextStatus(current: DealStatus): DealStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx === -1 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

export function useDeals(accountId: string, statusFilter?: string) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeals = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      let query = supabase
        .from("deal_truth_ledger")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDeals((data as Deal[]) || []);
    } catch (err) {
      console.error("Failed to load deals:", err);
      toast.error("Failed to load deals");
    } finally {
      setLoading(false);
    }
  }, [accountId, statusFilter]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  return { deals, loading, refetch: fetchDeals };
}

export function useDealDetail(dealId: string) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [artefacts, setArtefacts] = useState<DealArtefact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const [dealRes, eventsRes, artefactsRes] = await Promise.all([
        supabase.from("deal_truth_ledger").select("*").eq("id", dealId).single(),
        supabase.from("deal_truth_events").select("*").eq("deal_id", dealId).order("created_at", { ascending: true }),
        supabase.from("deal_truth_artefacts").select("*").eq("deal_id", dealId).order("created_at", { ascending: true }),
      ]);

      if (dealRes.error) throw dealRes.error;
      setDeal(dealRes.data as Deal);
      setEvents((eventsRes.data as DealEvent[]) || []);
      setArtefacts((artefactsRes.data as DealArtefact[]) || []);
    } catch (err) {
      console.error("Failed to load deal detail:", err);
      toast.error("Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Subscribe to realtime events
  useEffect(() => {
    if (!dealId) return;
    const channel = supabase
      .channel(`deal-events-${dealId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "deal_truth_events",
        filter: `deal_id=eq.${dealId}`,
      }, (payload) => {
        setEvents((prev) => [...prev, payload.new as DealEvent]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [dealId]);

  return { deal, events, artefacts, loading, refetch: fetchAll };
}

export async function createDealFromOpportunity(opp: {
  id: string;
  account_id: string;
  url_canonical: string;
  listing_norm_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  match_score: number;
  reasons: Record<string, string>;
  source_searched: string | null;
}, createdBy: string) {
  const { data: deal, error: dealErr } = await supabase
    .from("deal_truth_ledger")
    .insert({
      account_id: opp.account_id,
      source: opp.source_searched || "other",
      url_canonical: opp.url_canonical,
      listing_norm_id: opp.listing_norm_id,
      matched_opportunity_id: opp.id,
      make: opp.make,
      model: opp.model,
      year: opp.year,
      km: opp.km,
      asking_price: opp.asking_price,
      status: "identified",
      created_by: createdBy,
    })
    .select()
    .single();

  if (dealErr) throw dealErr;

  // Insert the identified event
  await supabase.from("deal_truth_events").insert({
    deal_id: deal.id,
    event_type: "identified",
    event_payload: {
      match_score: opp.match_score,
      reasons: opp.reasons,
      source: opp.source_searched,
      url: opp.url_canonical,
    },
    created_by: createdBy,
  });

  return deal as Deal;
}

export async function transitionDealStatus(
  dealId: string,
  newStatus: DealStatus,
  createdBy: string,
  payload: Record<string, unknown> = {}
) {
  const { error } = await supabase
    .from("deal_truth_ledger")
    .update({ status: newStatus })
    .eq("id", dealId);

  if (error) throw error;

  await supabase.from("deal_truth_events").insert({
    deal_id: dealId,
    event_type: newStatus,
    event_payload: { ...payload, transitioned_at: new Date().toISOString() },
    created_by: createdBy,
  });
}

export async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadDealArtefact(
  dealId: string,
  accountId: string,
  artefactType: string,
  file: File,
  createdBy: string
) {
  const hash = await computeSha256(file);
  const timestamp = Date.now();
  const path = `${accountId}/${dealId}/${artefactType}/${timestamp}_${file.name}`;

  const { error: uploadErr } = await supabase.storage
    .from("deal-artefacts")
    .upload(path, file);

  if (uploadErr) throw uploadErr;

  const { data: urlData } = supabase.storage
    .from("deal-artefacts")
    .getPublicUrl(path);

  const { data: artefact, error: insertErr } = await supabase
    .from("deal_truth_artefacts")
    .insert({
      deal_id: dealId,
      artefact_type: artefactType,
      file_url: path,
      file_hash: hash,
      mime_type: file.type || "application/octet-stream",
      created_by: createdBy,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  // Log event
  await supabase.from("deal_truth_events").insert({
    deal_id: dealId,
    event_type: `${artefactType}_uploaded`,
    event_payload: {
      artefact_id: artefact.id,
      file_name: file.name,
      file_hash: hash,
      mime_type: file.type,
    },
    created_by: createdBy,
  });

  return artefact as DealArtefact;
}
