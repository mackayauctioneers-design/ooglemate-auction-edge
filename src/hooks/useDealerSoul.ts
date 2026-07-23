import { useEffect, useState } from "react";
import { dealersoul } from "@/lib/api/dealersoul";

export type DealerSoulStats = {
  total_sales?: number;
  total_fingerprints?: number;
  active_deals?: number;
  avg_margin_pct?: number;
  dealer_id?: string;
  [k: string]: unknown;
};

export function useDealerSoulStats() {
  const [data, setData] = useState<DealerSoulStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await dealersoul.stats();
        if (alive) setData(r as DealerSoulStats);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { data, loading, error };
}

export type DealerSoulDeal = {
  id?: string | number;
  make?: string;
  model?: string;
  year?: number;
  km?: number;
  price?: number;
  buy_ceiling?: number;
  margin_pct?: number;
  confidence?: string | number;
  url?: string;
  source?: string;
  [k: string]: unknown;
};

export function useDealerSoulDeals(limit = 20) {
  const [data, setData] = useState<DealerSoulDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await dealersoul.deals(limit) as { deals?: DealerSoulDeal[] } | DealerSoulDeal[];
        const list = Array.isArray(r) ? r : r?.deals ?? [];
        if (alive) setData(list);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [limit]);

  return { data, loading, error };
}
