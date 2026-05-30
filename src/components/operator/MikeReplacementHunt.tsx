import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Gavel, Store } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Candidate {
  id: string;
  source: string | null;
  auction_house: string | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  reserve: number | null;
  highest_bid: number | null;
  listing_url: string | null;
  auction_datetime: string | null;
  location: string | null;
  status: string | null;
}

const AUCTION_SOURCES = ["pickles", "grays", "manheim", "slattery", "bidsonline"];

interface Props {
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  mikePrice: number | null;
}

function fmt$(n: number | null | undefined) {
  return n == null ? "—" : `$${Number(n).toLocaleString()}`;
}
function fmtK(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(Number(n) / 1000)}k`;
}

export function MikeReplacementHunt({ make, model, year, km, mikePrice }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Candidate[]>([]);
  const [tab, setTab] = useState<"auction" | "retail">("auction");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!make || !model) { setLoading(false); return; }
      setLoading(true);
      let q = supabase
        .from("vehicle_listings")
        .select("id,source,auction_house,make,model,variant_raw,year,km,asking_price,reserve,highest_bid,listing_url,auction_datetime,location,status")
        .ilike("make", make)
        .ilike("model", `%${model}%`)
        .gte("last_seen_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .limit(40);
      if (year) q = q.gte("year", year - 1).lte("year", year + 1);
      const { data } = await q;
      if (!alive) return;
      setItems((data as Candidate[]) || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [make, model, year]);

  const auctionItems = items
    .filter(i => AUCTION_SOURCES.includes((i.source || "").toLowerCase()) || i.auction_house)
    .sort((a, b) => {
      const ad = a.auction_datetime ? new Date(a.auction_datetime).getTime() : Infinity;
      const bd = b.auction_datetime ? new Date(b.auction_datetime).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, 10);

  const retailItems = items
    .filter(i => !AUCTION_SOURCES.includes((i.source || "").toLowerCase()) && !i.auction_house)
    .sort((a, b) => (a.asking_price ?? 9e9) - (b.asking_price ?? 9e9))
    .slice(0, 10);

  const view = tab === "auction" ? auctionItems : retailItems;

  return (
    <div className="bg-muted/30 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Replacements for <span className="font-medium text-foreground">{year} {make} {model}</span>
          {mikePrice ? <> — Mike asking <span className="font-medium text-foreground">{fmt$(mikePrice)}</span></> : null}
          {km ? <> · {fmtK(km)}</> : null}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={tab === "auction" ? "default" : "outline"} onClick={() => setTab("auction")} className="h-7 text-xs">
            <Gavel className="h-3 w-3 mr-1" /> Auction ({auctionItems.length})
          </Button>
          <Button size="sm" variant={tab === "retail" ? "default" : "outline"} onClick={() => setTab("retail")} className="h-7 text-xs">
            <Store className="h-3 w-3 mr-1" /> Retail ({retailItems.length})
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : view.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          No {tab} matches in the last 14 days for {make} {model} {year ? `(${year - 1}–${year + 1})` : ""}.
        </div>
      ) : (
        <div className="space-y-1.5">
          {view.map(c => {
            const price = c.asking_price ?? c.highest_bid ?? c.reserve;
            const delta = price && mikePrice ? price - mikePrice : null;
            return (
              <div key={c.id} className="flex items-center gap-3 text-xs bg-background rounded border px-3 py-2">
                <Badge variant="outline" className="text-[10px]">
                  {(c.source || c.auction_house || "—").toString().slice(0, 12)}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {c.year} {c.make} {c.model} {c.variant_raw && <span className="text-muted-foreground font-normal">· {c.variant_raw}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap">
                    <span>{fmtK(c.km)}</span>
                    {c.location && <span>· {c.location}</span>}
                    {c.auction_datetime && (
                      <span>· auction {formatDistanceToNow(new Date(c.auction_datetime), { addSuffix: true })}</span>
                    )}
                    {c.status && <span>· {c.status}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold">{fmt$(price)}</div>
                  {delta != null && (
                    <div className={`text-[10px] ${delta < 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {delta < 0 ? "" : "+"}{fmt$(delta)} vs Mike
                    </div>
                  )}
                </div>
                {c.listing_url && (
                  <a href={c.listing_url} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
