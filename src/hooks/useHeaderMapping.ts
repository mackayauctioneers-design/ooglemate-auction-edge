import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface HeaderMapping {
  [sourceHeader: string]: string | null;
}

export interface MappingProfile {
  id: string;
  account_id: string;
  profile_name: string;
  header_map: HeaderMapping;
  source_headers: string[];
  created_at: string;
}

const CANONICAL_FIELDS = [
  { value: "sold_at", label: "Sale Date", required: true },
  { value: "acquired_at", label: "Acquired Date", required: false },
  { value: "make", label: "Make", required: true },
  { value: "model", label: "Model", required: true },
  { value: "series", label: "Series", required: true },
  { value: "badge", label: "Badge", required: true },
  { value: "variant", label: "Variant", required: false },
  { value: "year", label: "Year", required: true },
  { value: "km", label: "Kilometres Sold", required: true },
  { value: "sale_price", label: "Sale Price", required: true },
  { value: "buy_price", label: "Buy Price", required: false },
  { value: "gross_profit", label: "Gross Profit", required: false },
  { value: "days_to_clear", label: "Days in Stock", required: false },
  { value: "transmission", label: "Transmission", required: false },
  { value: "fuel_type", label: "Fuel Type", required: false },
  { value: "body_type", label: "Body Type", required: false },
  { value: "notes", label: "Notes", required: false },
  { value: "location", label: "Location", required: false },
  { value: "dealer_name", label: "Dealer Name", required: false },
  { value: "description", label: "Description (Display Only)", required: false },
  { value: "rego", label: "Rego / Plate", required: false },
  { value: "vin", label: "VIN / Chassis", required: false },
  { value: "colour", label: "Colour", required: false },
  { value: "stock_no", label: "Stock No", required: false },
] as const;

export { CANONICAL_FIELDS };

export function useMappingProfiles(accountId: string) {
  return useQuery({
    queryKey: ["mapping-profiles", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("upload_mapping_profiles" as any)
        .select("*")
        .eq("account_id", accountId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MappingProfile[];
    },
    enabled: !!accountId,
  });
}

export function useAIMapping() {
  return useMutation({
    mutationFn: async ({
      headers,
      sampleRows,
    }: {
      headers: string[];
      sampleRows?: Record<string, string>[];
    }) => {
      const { data, error } = await supabase.functions.invoke("sales-header-mapper", {
        body: { headers, sample_rows: sampleRows },
      });
      if (error) throw error;
      return data as { mapping: HeaderMapping; method: string };
    },
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      accountId,
      profileName,
      headerMap,
      sourceHeaders,
    }: {
      accountId: string;
      profileName: string;
      headerMap: HeaderMapping;
      sourceHeaders: string[];
    }) => {
      const { data, error } = await supabase
        .from("upload_mapping_profiles" as any)
        .upsert(
          {
            account_id: accountId,
            profile_name: profileName,
            header_map: headerMap,
            source_headers: sourceHeaders,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "account_id,profile_name" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mapping-profiles"] });
      toast.success("Mapping profile saved");
    },
  });
}

export function findMatchingProfile(
  profiles: MappingProfile[],
  headers: string[]
): MappingProfile | null {
  if (!profiles?.length) return null;
  const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()));
  
  for (const profile of profiles) {
    const profileSet = new Set(
      profile.source_headers.map((h) => h.toLowerCase().trim())
    );
    // Match if 80%+ of headers overlap
    const overlap = [...headerSet].filter((h) => profileSet.has(h)).length;
    if (overlap >= Math.min(headerSet.size, profileSet.size) * 0.8) {
      return profile;
    }
  }
  return null;
}
