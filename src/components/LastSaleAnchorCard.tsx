import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type LastSale = {
  sale_date: string | null;
  make: string | null;
  model: string | null;
  variant_used: string | null;
  year: number | null;
  km: number | null;
  sale_price: number | null;
  days_in_stock: number | null;
  region_id: string | null;
  match_scope: "REGION_STRICT" | "NATIONAL" | "NO_VARIANT" | string;
};

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function scopeBadge(scope: string) {
  const s = (scope || "").toUpperCase();
  if (s === "REGION_STRICT") return { label: "Region match", variant: "default" as const };
  if (s === "NATIONAL") return { label: "National match", variant: "secondary" as const };
  if (s === "NO_VARIANT") return { label: "No-variant match", variant: "outline" as const };
  return { label: s || "Match", variant: "outline" as const };
}

interface LastSaleAnchorCardProps {
  make: string;
  model: string;
  variant_used?: string | null;
  year: number;
  km?: number | null;
  region_id?: string | null;
  title?: string;
}

export function LastSaleAnchorCard(props: LastSaleAnchorCardProps) {
  const { make, model, variant_used, year, km, region_id } = props;

  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState<LastSale | null>(null);

  const canQuery = useMemo(() => !!make && !!model && !!year, [make, model, year]);

  useEffect(() => {
    if (!canQuery) {
      setSale(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setSale(null);

      const { data, error } = await supabase.rpc("get_last_equivalent_sale_ui", {
        p_make: make,
        p_model: model,
        p_variant_used: (variant_used || "").toString(),
        p_year: year,
        p_km: km ?? 0,
        p_region_id: region_id ?? null,
      });

      if (cancelled) return;

      if (error) {
        console.error("[LastSaleAnchorCard] RPC error:", error);
        setSale(null);
      } else {
        setSale(Array.isArray(data) && data.length > 0 ? (data[0] as LastSale) : null);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [canQuery, make, model, variant_used, year, km, region_id]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{props.title || "Last Sale Anchor"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !sale ? (
          <div className="text-sm text-muted-foreground">
            No equivalent sale found yet. Log more sales to strengthen this.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={scopeBadge(sale.match_scope).variant}>
                {scopeBadge(sale.match_scope).label}
              </Badge>
              <div className="text-xs text-muted-foreground">
                {sale.sale_date ? `Sold ${new Date(sale.sale_date).toLocaleDateString()}` : "Sold date —"}
              </div>
            </div>

            <div className="text-sm font-medium">
              {sale.year ?? "—"} {sale.make ?? "—"} {sale.model ?? "—"}
              {sale.variant_used ? ` (${sale.variant_used})` : ""}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Sold for</div>
                <div className="font-semibold">{fmtMoney(sale.sale_price)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Days in stock</div>
                <div className="font-semibold">{sale.days_in_stock ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">KM</div>
                <div className="font-semibold">{fmtNum(sale.km)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Region</div>
                <div className="font-semibold">{sale.region_id ?? "—"}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
