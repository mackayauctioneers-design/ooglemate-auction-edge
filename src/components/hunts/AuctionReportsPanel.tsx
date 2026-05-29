import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Radar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Report {
  id: string;
  job_id: string;
  listing_url: string;
  source: string | null;
  scrape_status: string | null;
  title: string | null;
  price_aud: number | null;
  odometer_km: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  state: string | null;
  seller_name: string | null;
  auction_date: string | null;
  current_status: string | null;
  notes: string | null;
  received_at: string;
}

export function AuctionReportsPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_my_star_watch_reports', { _limit: 25 });
      if (!error && data) setReports(data as Report[]);
      setLoading(false);
    })();
  }, []);

  const toggle = (id: string) =>
    setExpanded((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading auction reports…
      </div>
    );
  }

  if (!reports.length) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-card mb-6">
        <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground">Auction Reports</h3>
            <Badge variant="secondary">{reports.length}</Badge>
            <span className="text-xs text-muted-foreground ml-2">
              Condition packs Arby pulled from your starred lots
            </span>
          </div>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="divide-y divide-border">
            {reports.map((r) => {
              const title =
                r.title ||
                [r.year, r.make, r.model, r.variant].filter(Boolean).join(' ') ||
                'Starred lot';
              const isOpen = expanded.has(r.id);
              return (
                <div key={r.id} className="p-4">
                  <button
                    onClick={() => toggle(r.id)}
                    className="w-full flex items-start justify-between gap-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground truncate">{title}</span>
                        {r.scrape_status && (
                          <Badge
                            variant={r.scrape_status === 'complete' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {r.scrape_status}
                          </Badge>
                        )}
                        {r.source && (
                          <Badge variant="outline" className="text-xs">
                            {r.source}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        {r.price_aud != null && (
                          <span>${Number(r.price_aud).toLocaleString()}</span>
                        )}
                        {r.odometer_km != null && (
                          <span>{Number(r.odometer_km).toLocaleString()} km</span>
                        )}
                        {r.state && <span>{r.state}</span>}
                        {r.auction_date && (
                          <span>
                            Auction {formatDistanceToNow(new Date(r.auction_date), { addSuffix: true })}
                          </span>
                        )}
                        <span>
                          Received {formatDistanceToNow(new Date(r.received_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-2 text-sm">
                      {r.seller_name && (
                        <div>
                          <span className="text-muted-foreground">Seller: </span>
                          <span className="text-foreground">{r.seller_name}</span>
                        </div>
                      )}
                      {r.current_status && (
                        <div>
                          <span className="text-muted-foreground">Status: </span>
                          <span className="text-foreground">{r.current_status}</span>
                        </div>
                      )}
                      {r.notes && (
                        <div className="rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap text-foreground">
                          {r.notes}
                        </div>
                      )}
                      {r.listing_url && (
                        <Button asChild size="sm" variant="outline">
                          <a href={r.listing_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Open lot
                          </a>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
