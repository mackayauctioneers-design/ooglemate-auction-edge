import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  getRegionalSummary, 
  getTopHeatAlerts,
  REGIONS,
  RegionalSummary,
  GeoHeatAlert,
  RegionConfig 
} from '@/services/regionalDashboardService';
import { MapPin, TrendingUp, TrendingDown, Clock, BarChart3, Star, AlertTriangle } from 'lucide-react';

function HeatAlertCard({ alert }: { alert: GeoHeatAlert }) {
  const tierColors: Record<string, string> = {
    'EARLY_PRIVATE_LED': 'bg-orange-500/10 text-orange-600 border-orange-500/30',
    'CONFIRMED_DEALER_VALIDATED': 'bg-green-500/10 text-green-600 border-green-500/30',
    'COOLING': 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  };

  const tierLabels: Record<string, string> = {
    'EARLY_PRIVATE_LED': 'Early Signal',
    'CONFIRMED_DEALER_VALIDATED': 'Confirmed Hot',
    'COOLING': 'Cooling',
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3">
        {alert.tier === 'COOLING' ? (
          <TrendingDown className="h-4 w-4 text-blue-500" />
        ) : (
          <TrendingUp className="h-4 w-4 text-orange-500" />
        )}
        <div>
          <p className="font-medium text-sm">
            {alert.make} {alert.model}
            {alert.variant_bucket !== 'ALL' && (
              <span className="text-muted-foreground ml-1">({alert.variant_bucket})</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {alert.tagline || `${alert.pct_change ? `${(alert.pct_change * 100).toFixed(0)}% ` : ''}TTD change`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {alert.value_short !== null && (
          <span className="text-xs text-muted-foreground">
            {alert.value_short.toFixed(0)}d TTD
          </span>
        )}
        <Badge variant="outline" className={tierColors[alert.tier] || ''}>
          {tierLabels[alert.tier] || alert.tier}
        </Badge>
      </div>
    </div>
  );
}

function RegionCard({ summary }: { summary: RegionalSummary }) {
  const hasAlerts = summary.active_alerts > 0;
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{summary.region.label}</CardTitle>
            {summary.region.anchor_dealer && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Star className="h-3 w-3" />
                {summary.region.anchor_dealer}
              </Badge>
            )}
          </div>
          {hasAlerts && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {summary.active_alerts} alerts
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {summary.total_listings_7d} listings tracked (7d)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Avg Days to Clear</p>
              <p className="text-sm font-medium">
                {summary.avg_days_to_clear_7d !== null 
                  ? `${summary.avg_days_to_clear_7d.toFixed(1)} days`
                  : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Hot Models</p>
              <p className="text-sm font-medium">{summary.hot_models.length}</p>
            </div>
          </div>
        </div>

        {/* Top Alerts */}
        {summary.hot_models.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Top Signals</p>
            <div className="space-y-1">
              {summary.hot_models.slice(0, 3).map(alert => (
                <HeatAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RegionDetail({ regionConfig }: { regionConfig: RegionConfig }) {
  const [summary, setSummary] = useState<RegionalSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const data = await getRegionalSummary(regionConfig);
      setSummary(data);
      setLoading(false);
    };
    fetchData();
  }, [regionConfig.region_id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!summary) {
    return <p className="text-muted-foreground">No data available for this region.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Region Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Avg Days to Clear
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.avg_days_to_clear_7d !== null 
                ? `${summary.avg_days_to_clear_7d.toFixed(1)}`
                : '—'}
            </p>
            <p className="text-xs text-muted-foreground">7-day average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Total Listings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.total_listings_7d}</p>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.active_alerts}</p>
            <p className="text-xs text-muted-foreground">Heat signals</p>
          </CardContent>
        </Card>
      </div>

      {/* Hot Models */}
      {summary.hot_models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Hot Models
            </CardTitle>
            <CardDescription>
              Models showing increased demand signals
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.hot_models.map(alert => (
              <HeatAlertCard key={alert.id} alert={alert} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Cooling Models */}
      {summary.cooling_models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-blue-500" />
              Cooling Models
            </CardTitle>
            <CardDescription>
              Models with decreasing demand
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.cooling_models.map(alert => (
              <HeatAlertCard key={alert.id} alert={alert} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {summary.hot_models.length === 0 && summary.cooling_models.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active heat alerts for this region.</p>
            <p className="text-xs mt-1">Alerts will appear when significant demand changes are detected.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function RegionalDashboardPage() {
  const [topAlerts, setTopAlerts] = useState<GeoHeatAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const alerts = await getTopHeatAlerts(10);
      setTopAlerts(alerts);
      setLoading(false);
    };
    fetchData();
  }, []);

  // Default to Central Coast NSW
  const defaultRegion = REGIONS.find(r => r.region_id === 'CENTRAL_COAST_NSW') || REGIONS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Regional Dashboard</h1>
        <p className="text-muted-foreground">
          Geo-liquidity signals and heat alerts by region
        </p>
      </div>

      <Tabs defaultValue={defaultRegion.region_id} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          {REGIONS.map(region => (
            <TabsTrigger key={region.region_id} value={region.region_id} className="text-xs">
              {region.label}
              {region.anchor_dealer && <Star className="h-3 w-3 ml-1 text-yellow-500" />}
            </TabsTrigger>
          ))}
        </TabsList>

        {REGIONS.map((region, index) => (
          <TabsContent key={region.region_id} value={region.region_id}>
            <RegionDetail regionConfig={region} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Global Top Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Heat Alerts (All Regions)</CardTitle>
          <CardDescription>Latest demand signals across all tracked regions</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : topAlerts.length > 0 ? (
            <div className="space-y-2">
              {topAlerts.map(alert => (
                <HeatAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              No active heat alerts across any region.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
