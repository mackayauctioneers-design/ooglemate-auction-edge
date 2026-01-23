import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Search, Zap, DollarSign, Car } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SalePattern {
  make: string;
  model: string;
  year_min: number;
  year_max: number;
  avg_km: number;
  avg_profit: number;
  avg_buy_price: number;
  sale_count: number;
}

interface HuntResult {
  mission_name: string;
  found: number;
  success: boolean;
}

export function SalesPatternHunter() {
  const [patterns, setPatterns] = useState<SalePattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [hunting, setHunting] = useState<string | null>(null);
  const [results, setResults] = useState<HuntResult[]>([]);

  useEffect(() => {
    fetchPatterns();
  }, []);

  async function fetchPatterns() {
    try {
      const { data, error } = await supabase
        .from("dealer_sales")
        .select("make, model, year, km, buy_price, gross_profit")
        .not("gross_profit", "is", null)
        .gt("gross_profit", 0);

      if (error) throw error;

      // Aggregate by make/model
      const aggregated = new Map<string, {
        make: string;
        model: string;
        years: number[];
        kms: number[];
        profits: number[];
        buy_prices: number[];
      }>();

      (data || []).forEach((sale) => {
        const key = `${sale.make}|${sale.model}`;
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            make: sale.make,
            model: sale.model,
            years: [],
            kms: [],
            profits: [],
            buy_prices: [],
          });
        }
        const entry = aggregated.get(key)!;
        if (sale.year) entry.years.push(sale.year);
        if (sale.km) entry.kms.push(sale.km);
        if (sale.gross_profit) entry.profits.push(sale.gross_profit);
        if (sale.buy_price) entry.buy_prices.push(sale.buy_price);
      });

      const patternList: SalePattern[] = [];
      aggregated.forEach((v) => {
        if (v.profits.length >= 1) {
          patternList.push({
            make: v.make,
            model: v.model,
            year_min: Math.min(...v.years),
            year_max: Math.max(...v.years),
            avg_km: Math.round(v.kms.reduce((a, b) => a + b, 0) / v.kms.length),
            avg_profit: Math.round(v.profits.reduce((a, b) => a + b, 0) / v.profits.length),
            avg_buy_price: Math.round(v.buy_prices.reduce((a, b) => a + b, 0) / v.buy_prices.length),
            sale_count: v.profits.length,
          });
        }
      });

      // Sort by avg profit descending
      patternList.sort((a, b) => b.avg_profit - a.avg_profit);
      setPatterns(patternList);
    } catch (e) {
      console.error("Failed to fetch patterns:", e);
      toast.error("Failed to load sales patterns");
    } finally {
      setLoading(false);
    }
  }

  async function launchHunt(pattern: SalePattern) {
    const missionName = `${pattern.make} ${pattern.model} ${pattern.year_min}-${pattern.year_max}`;
    setHunting(missionName);

    try {
      const mission = {
        mission_name: missionName,
        make: pattern.make,
        model: pattern.model,
        year_min: pattern.year_min,
        year_max: pattern.year_max,
        km_max: Math.round(pattern.avg_km * 1.5), // Allow 50% more km
        price_max: Math.round(pattern.avg_buy_price * 1.1), // Allow 10% over avg buy
        location: "Australia",
        seller_type: ["dealer", "private"],
        allowed_domains: ["carsales.com.au", "autotrader.com.au", "gumtree.com.au"],
        notes: `Based on ${pattern.sale_count} profitable sales averaging $${pattern.avg_profit.toLocaleString()} profit`,
      };

      const { data, error } = await supabase.functions.invoke("run-grok-mission", {
        body: mission,
      });

      if (error) throw error;

      setResults((prev) => [
        { mission_name: missionName, found: data?.found || 0, success: true },
        ...prev,
      ]);

      if (data?.found > 0) {
        toast.success(`Found ${data.found} candidates for ${missionName}`);
      } else {
        toast.info(`No matches found for ${missionName}`);
      }
    } catch (e: any) {
      console.error("Hunt failed:", e);
      toast.error(e.message || "Hunt failed");
      setResults((prev) => [
        { mission_name: missionName, found: 0, success: false },
        ...prev,
      ]);
    } finally {
      setHunting(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading sales patterns...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Hunt From Sales History
              </CardTitle>
              <CardDescription>
                Auto-generate CaroogleAi Kiting Mode from your profitable sale patterns
              </CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" />
              {patterns.length} patterns
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {patterns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No profitable sales data found. Import sales to generate hunting patterns.
            </p>
          ) : (
            <div className="grid gap-3">
              {patterns.map((pattern) => {
                const isHunting = hunting === `${pattern.make} ${pattern.model} ${pattern.year_min}-${pattern.year_max}`;
                
                return (
                  <div
                    key={`${pattern.make}-${pattern.model}`}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Car className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">
                          {pattern.make} {pattern.model}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {pattern.year_min}-{pattern.year_max} • ~{(pattern.avg_km / 1000).toFixed(0)}k km • {pattern.sale_count} sales
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold">
                          <DollarSign className="h-4 w-4" />
                          {pattern.avg_profit.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">avg profit</div>
                      </div>
                      
                      <Button
                        size="sm"
                        onClick={() => launchHunt(pattern)}
                        disabled={!!hunting}
                      >
                        {isHunting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Hunting...
                          </>
                        ) : (
                          <>
                            <Search className="h-4 w-4 mr-1" />
                            Hunt
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Hunt Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.slice(0, 5).map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm p-2 rounded bg-muted/50"
                >
                  <span>{r.mission_name}</span>
                  {r.success ? (
                    <Badge variant={r.found > 0 ? "default" : "secondary"}>
                      {r.found} found
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
