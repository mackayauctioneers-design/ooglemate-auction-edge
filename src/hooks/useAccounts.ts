import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Account {
  id: string;
  slug: string;
  display_name: string;
  created_at: string;
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("display_name");
      if (error) throw error;
      return data as Account[];
    },
  });
}

export function useAccountBySlug(slug: string | null) {
  const { data: accounts } = useAccounts();
  return accounts?.find((a) => a.slug === slug) || null;
}
