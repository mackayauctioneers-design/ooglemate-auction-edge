import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Play, CheckCircle, AlertTriangle, Car } from 'lucide-react';
import { toast } from 'sonner';

interface CrawlResult {
  dealer: string;
  slug: string;
  parserMode: string;
  vehiclesFound: number;
  vehiclesIngested: number;
  vehiclesDropped: number;
  dropReasons: Record<string, number>;
  healthAlert: boolean;
  healthAlertType?: string;
  validationStatus?: string;
  error?: string;
}

interface TrapCrawlPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trapSlug: string;
  dealerName: string;
  parserMode?: string;
  onCrawlComplete?: () => void;
}

export function TrapCrawlPreviewDrawer({ open, onOpenChange, trapSlug, dealerName, parserMode, onCrawlComplete }: TrapCrawlPreviewDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CrawlResult | null>(null);

  const runCrawl = async () => {
    setLoading(true);
    setResult(null);
    try {
      // Route to dedicated crawl functions based on parser mode
      if (parserMode === 'easyauto_scrape') {
        const { data, error } = await supabase.functions.invoke('easyauto-scrape', {
          body: { maxPages: 2 },
        });

        if (error) throw error;

        const crawlResult: CrawlResult = {
          dealer: dealerName,
          slug: trapSlug,
          parserMode: 'easyauto_scrape',
          vehiclesFound: data?.totalFound || data?.listings_found || 0,
          vehiclesIngested: data?.ingested || data?.opportunities_created || 0,
          vehiclesDropped: data?.dropped || data?.filtered_out || 0,
          dropReasons: {},
          healthAlert: false,
          error: data?.error || undefined,
        };
        setResult(crawlResult);
        if (crawlResult.error) {
          toast.error(`Crawl failed: ${crawlResult.error}`);
        } else {
          toast.success(`Found ${crawlResult.vehiclesFound} EasyAuto123 vehicles`);
        }
        onCrawlComplete?.();
        return;
      }

      if (parserMode === 'pickles_buynow') {
        const { data, error } = await supabase.functions.invoke('pickles-search-harvest', {
          body: { mode: 'buynow', force: true },
        });

        if (error) throw error;

        const crawlResult: CrawlResult = {
          dealer: dealerName,
          slug: trapSlug,
          parserMode: 'pickles_buynow',
          vehiclesFound: data?.urls_found || data?.listings_found || data?.total_found || 0,
          vehiclesIngested: data?.priced || data?.detail_fetched || data?.ingested || 0,
          vehiclesDropped: data?.qualified_before_grok || 0,
          dropReasons: {},
          healthAlert: false,
          error: data?.error || undefined,
        };
        setResult(crawlResult);
        if (crawlResult.error) {
          toast.error(`Crawl failed: ${crawlResult.error}`);
        } else {
          toast.success(`Found ${crawlResult.vehiclesFound} Pickles Buy Now vehicles`);
        }
        onCrawlComplete?.();
        return;
      }

      if (parserMode === 'toyota_portal') {
        const { data, error } = await supabase.functions.invoke('toyota-used-portal-crawl', {
          body: { state: 'NSW', maxPages: 1 },
        });

        if (error) throw error;

        const crawlResult: CrawlResult = {
          dealer: dealerName,
          slug: trapSlug,
          parserMode: 'toyota_portal',
          vehiclesFound: data?.listings_found || 0,
          vehiclesIngested: data?.ingest_result?.ingested || 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          error: data?.error || undefined,
        };
        setResult(crawlResult);
        if (crawlResult.error) {
          toast.error(`Crawl failed: ${crawlResult.error}`);
        } else {
          toast.success(`Found ${crawlResult.vehiclesFound} vehicles from Toyota portal`);
        }
        onCrawlComplete?.();
        return;
      }

      // Default: use dealer-site-crawl
      const { data, error } = await supabase.functions.invoke('dealer-site-crawl', {
        body: { dealer_slugs: [trapSlug] },
      });

      if (error) throw error;

      const crawlResult = data?.results?.[0] as CrawlResult | undefined;
      if (crawlResult) {
        setResult(crawlResult);
        if (crawlResult.error) {
          toast.error(`Crawl failed: ${crawlResult.error}`);
        } else {
          toast.success(`Found ${crawlResult.vehiclesFound} vehicles, ingested ${crawlResult.vehiclesIngested}`);
        }
      }
      onCrawlComplete?.();
    } catch (err) {
      console.error('Crawl failed:', err);
      toast.error('Crawl request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Test Crawl: {dealerName}
          </SheetTitle>
          <SheetDescription>
            Run a live crawl via Firecrawl and preview extracted vehicles
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Button onClick={runCrawl} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Crawling {dealerName}...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Crawl Now
              </>
            )}
          </Button>

          {result && (
            <div className="space-y-4">
              {/* Status */}
              <Card className={result.error ? 'border-destructive' : 'border-emerald-500/30'}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    {result.error ? (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-emerald-500" />
                    )}
                    <span className="font-medium">
                      {result.error ? 'Crawl Failed' : 'Crawl Successful'}
                    </span>
                  </div>

                  {result.error && (
                    <p className="text-sm text-destructive mb-3">{result.error}</p>
                  )}

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-2xl font-bold">{result.vehiclesFound}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-emerald-500">{result.vehiclesIngested}</div>
                      <div className="text-xs text-muted-foreground">Ingested</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-muted-foreground">{result.vehiclesDropped}</div>
                      <div className="text-xs text-muted-foreground">Dropped</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Parser & Validation */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Parser: {result.parserMode}</Badge>
                {result.validationStatus && (
                  <Badge variant={result.validationStatus === 'passed' ? 'default' : 'secondary'}>
                    Validation: {result.validationStatus}
                  </Badge>
                )}
                {result.healthAlert && (
                  <Badge variant="destructive">Health Alert: {result.healthAlertType}</Badge>
                )}
              </div>

              {/* Drop Reasons */}
              {Object.keys(result.dropReasons).length > 0 && (
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm font-medium mb-2">Drop Reasons</div>
                    <div className="space-y-1">
                      {Object.entries(result.dropReasons).map(([reason, count]) => (
                        <div key={reason} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{reason.replace(/_/g, ' ')}</span>
                          <span className="font-mono">{count}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
