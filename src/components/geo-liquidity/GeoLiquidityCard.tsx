import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { GeoLiquidityBadge } from './GeoLiquidityBadge';
import { GeoLiquidityResult, AustralianState } from '@/types/geoLiquidity';
import { getGeoLiquiditySignal } from '@/services/geoLiquidityService';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { MapPin, Clock, BarChart3 } from 'lucide-react';

interface GeoLiquidityCardProps {
  make: string;
  model: string;
  variant_family?: string;
  year?: number;
  state?: AustralianState;
  className?: string;
}

/**
 * GeoLiquidityCard - Displays geo-liquidity signal for a vehicle.
 * Automatically hidden when feature flag is not visible to user.
 */
export function GeoLiquidityCard({
  make,
  model,
  variant_family,
  year,
  state,
  className,
}: GeoLiquidityCardProps) {
  const { isFeatureVisible, loading: flagsLoading } = useFeatureFlags();
  const [result, setResult] = useState<GeoLiquidityResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if feature is visible to current user
  const showGeoLiquidity = isFeatureVisible('geoLiquidity');

  useEffect(() => {
    // Don't fetch if feature is not visible
    if (!showGeoLiquidity || flagsLoading) {
      setLoading(false);
      return;
    }

    const fetchSignal = async () => {
      setLoading(true);
      try {
        const data = await getGeoLiquiditySignal({
          make,
          model,
          variant_family,
          year,
          state,
        });
        setResult(data);
      } catch (error) {
        console.error('Failed to fetch geo-liquidity signal:', error);
        setResult(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSignal();
  }, [make, model, variant_family, year, state, showGeoLiquidity, flagsLoading]);

  // Don't render anything if feature is not visible
  if (flagsLoading || !showGeoLiquidity) {
    return null;
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!result || !result.signal) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Geo-Liquidity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No liquidity data available for this vehicle
          </p>
        </CardContent>
      </Card>
    );
  }

  const { signal, confidence } = result;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Geo-Liquidity: {signal.state}
          </CardTitle>
          <GeoLiquidityBadge tier={signal.liquidity_tier} reason={signal.tier_reason} />
        </div>
        <CardDescription className="text-xs">
          {signal.make} {signal.model} {signal.variant_family && `(${signal.variant_family})`}
          {' '}{signal.year_range.min}–{signal.year_range.max}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3">
          {signal.avg_days_to_sell !== null && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Avg Days to Sell</p>
                <p className="text-sm font-medium">{signal.avg_days_to_sell.toFixed(0)} days</p>
              </div>
            </div>
          )}
          
          {signal.pass_rate !== null && (
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Pass Rate</p>
                <p className="text-sm font-medium">{(signal.pass_rate * 100).toFixed(0)}%</p>
              </div>
            </div>
          )}
        </div>

        {/* Sample Size & Confidence */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Based on {signal.sample_size} vehicles</span>
          <Badge variant="outline" className="text-xs">
            {confidence} confidence
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
