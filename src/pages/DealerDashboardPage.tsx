import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, Minus, Flame, Snowflake, Target, Car, MapPin } from 'lucide-react';
import { SpecMatchesCard } from '@/components/dealer/SpecMatchesCard';

// ============================================================================
// DEALER DASHBOARD v1 - Brian Hilton Toyota Only
// ============================================================================
// Region: CENTRAL_COAST_NSW
// Panels: Market Pulse, Your Stock vs Market, Suggested Focus
// Rules: No raw metrics, no percentages, no rankings, no other dealer identities
// ============================================================================

const ALLOWED_DEALERS = ['Brian Hilton Toyota'];
const REGION_ID = 'CENTRAL_COAST_NSW';
const REGION_LABEL = 'Central Coast NSW';

// Sanitized category labels (no raw data)
type MarketSignal = 'hot' | 'stable' | 'cooling';
type StockComparison = 'faster' | 'in_line' | 'slower';

interface CategorySignal {
  category: string;
  signal: MarketSignal;
}

interface StockInsight {
  category: string;
  comparison: StockComparison;
}

interface SuggestedFocus {
  category: string;
  hint: string;
}

// Map raw tier data to sanitized signals (hide the actual tier names)
function tierToSignal(tier: string): MarketSignal {
  if (tier === 'EARLY_PRIVATE_LED' || tier === 'CONFIRMED_DEALER_VALIDATED') {
    return 'hot';
  }
  if (tier === 'COOLING') {
    return 'cooling';
  }
  return 'stable';
}

// Generate gentle prompts without raw data
function generateSuggestions(hotCategories: string[]): SuggestedFocus[] {
  if (hotCategories.length === 0) return [];
  
  return hotCategories.slice(0, 3).map(category => ({
    category,
    hint: `Consider stocking more ${category} - local demand is strong`,
  }));
}

function SignalBadge({ signal }: { signal: MarketSignal }) {
  const config = {
    hot: { 
      icon: Flame, 
      label: 'Hot', 
      className: 'bg-orange-500/10 text-orange-600 border-orange-500/30' 
    },
    stable: { 
      icon: Minus, 
      label: 'Stable', 
      className: 'bg-slate-500/10 text-slate-600 border-slate-500/30' 
    },
    cooling: { 
      icon: Snowflake, 
      label: 'Cooling', 
      className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' 
    },
  };
  
  const { icon: Icon, label, className } = config[signal];
  
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function ComparisonBadge({ comparison }: { comparison: StockComparison }) {
  const config = {
    faster: { 
      icon: TrendingUp, 
      label: 'Faster than market', 
      className: 'bg-green-500/10 text-green-600 border-green-500/30' 
    },
    in_line: { 
      icon: Minus, 
      label: 'In line with market', 
      className: 'bg-slate-500/10 text-slate-600 border-slate-500/30' 
    },
    slower: { 
      icon: TrendingDown, 
      label: 'Slower than market', 
      className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' 
    },
  };
  
  const { icon: Icon, label, className } = config[comparison];
  
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function MarketPulsePanel({ categories }: { categories: CategorySignal[] }) {
  const hotCount = categories.filter(c => c.signal === 'hot').length;
  const coolingCount = categories.filter(c => c.signal === 'cooling').length;
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-base">Market Pulse</CardTitle>
        </div>
        <CardDescription>
          Current demand signals in {REGION_LABEL}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex gap-4 text-sm">
          {hotCount > 0 && (
            <span className="text-orange-600">{hotCount} hot categories</span>
          )}
          {coolingCount > 0 && (
            <span className="text-blue-600">{coolingCount} cooling</span>
          )}
          {hotCount === 0 && coolingCount === 0 && (
            <span className="text-muted-foreground">Market is stable</span>
          )}
        </div>
        
        {/* Category list */}
        <div className="space-y-2">
          {categories.map((cat, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
              <span className="text-sm font-medium">{cat.category}</span>
              <SignalBadge signal={cat.signal} />
            </div>
          ))}
        </div>
        
        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No significant market signals detected
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StockComparisonPanel({ insights }: { insights: StockInsight[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Your Stock vs Market</CardTitle>
        </div>
        <CardDescription>
          How your inventory is performing locally
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((insight, i) => (
          <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
            <span className="text-sm font-medium">{insight.category}</span>
            <ComparisonBadge comparison={insight.comparison} />
          </div>
        ))}
        
        {insights.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Not enough data yet to compare your stock
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestedFocusPanel({ suggestions }: { suggestions: SuggestedFocus[] }) {
  if (suggestions.length === 0) {
    return null;
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-green-500" />
          <CardTitle className="text-base">Suggested Focus</CardTitle>
        </div>
        <CardDescription>
          Opportunities based on local demand
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((suggestion, i) => (
          <div key={i} className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="text-sm font-medium text-green-700">{suggestion.category}</p>
            <p className="text-xs text-muted-foreground mt-1">{suggestion.hint}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DealerDashboardPage() {
  const { isFeatureVisible, loading: flagsLoading } = useFeatureFlags();
  const { currentUser, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [marketCategories, setMarketCategories] = useState<CategorySignal[]>([]);
  const [stockInsights, setStockInsights] = useState<StockInsight[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedFocus[]>([]);

  // Check access: feature flag + allowed dealer
  const isDealerAllowed = currentUser && ALLOWED_DEALERS.includes(currentUser.dealer_name);
  const hasAccess = isAdmin || (isFeatureVisible('dealerDashboard') && isDealerAllowed);

  useEffect(() => {
    if (!hasAccess || flagsLoading) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch heat alerts for the region (sanitized - no early/private signals for dealers)
        const { data: alerts } = await supabase
          .from('geo_heat_alerts')
          .select('make, model, tier, status')
          .eq('region_id', REGION_ID)
          .eq('status', 'active')
          .eq('audience', 'internal') // Only fetch dealer-safe alerts
          .limit(20);

        // Transform to sanitized categories (group by make)
        const categoryMap = new Map<string, MarketSignal>();
        
        if (alerts) {
          for (const alert of alerts) {
            // Skip early/private-led signals for dealer view
            if (alert.tier === 'EARLY_PRIVATE_LED') continue;
            
            const category = alert.make;
            const signal = tierToSignal(alert.tier);
            
            // Hot takes precedence over stable, cooling is separate
            const existing = categoryMap.get(category);
            if (!existing || (signal === 'hot' && existing !== 'hot')) {
              categoryMap.set(category, signal);
            }
          }
        }

        const categories: CategorySignal[] = Array.from(categoryMap.entries())
          .map(([category, signal]) => ({ category, signal }))
          .sort((a, b) => {
            const order = { hot: 0, cooling: 1, stable: 2 };
            return order[a.signal] - order[b.signal];
          });

        setMarketCategories(categories);

        // Generate suggestions from hot categories
        const hotCategories = categories
          .filter(c => c.signal === 'hot')
          .map(c => c.category);
        setSuggestions(generateSuggestions(hotCategories));

        // Stock comparison would require dealer inventory data
        // For now, show empty state (to be connected when dealer inventory is tracked)
        setStockInsights([]);

      } catch (error) {
        console.error('Error loading dealer dashboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hasAccess, flagsLoading]);

  // Not allowed
  if (!flagsLoading && !hasAccess) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dealer Dashboard</h1>
          <p className="text-muted-foreground">
            This dashboard is not available for your account.
          </p>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Contact your account manager to request access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || flagsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Dealer Dashboard</h1>
          <Badge variant="outline" className="text-xs">
            <MapPin className="h-3 w-3 mr-1" />
            {REGION_LABEL}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          Local market insights for {currentUser?.dealer_name || 'your dealership'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MarketPulsePanel categories={marketCategories} />
        <SpecMatchesCard showAll={false} limit={10} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StockComparisonPanel insights={stockInsights} />
        <SuggestedFocusPanel suggestions={suggestions} />
      </div>
    </div>
  );
}
