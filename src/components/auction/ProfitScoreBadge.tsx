import { Flame, Thermometer, Snowflake, TrendingUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getProfitHeatLevel } from '@/hooks/useAuctionProfitScore';

interface ProfitScoreBadgeProps {
  score: number;
  profitDenseCount: number;
  sampleSize: number;
  medianGp?: number | null;
  showTooltip?: boolean;
  compact?: boolean;
}

export function ProfitScoreBadge({
  score,
  profitDenseCount,
  sampleSize,
  medianGp,
  showTooltip = true,
  compact = false,
}: ProfitScoreBadgeProps) {
  const heat = getProfitHeatLevel(score);
  const isLowSample = sampleSize < 3;
  
  const config = {
    hot: { 
      icon: Flame, 
      label: 'Hot',
      bgClass: 'bg-primary/20 border-primary/40',
      textClass: 'text-primary',
    },
    warm: { 
      icon: Thermometer, 
      label: 'Warm',
      bgClass: 'bg-muted border-border',
      textClass: 'text-foreground',
    },
    cold: { 
      icon: Snowflake, 
      label: 'Cold',
      bgClass: 'bg-muted/50 border-border/50',
      textClass: 'text-muted-foreground',
    },
  };
  
  const { icon: Icon, label, bgClass, textClass } = config[heat];

  const badge = (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-md border ${bgClass}`}>
      <div className={`flex items-center gap-1 ${textClass}`}>
        <Icon className="h-4 w-4" />
        {!compact && (
          <span className="text-xs font-semibold">{label}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <div className="flex items-center gap-0.5">
          <TrendingUp className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono font-medium">{score.toFixed(1)}</span>
        </div>
        {profitDenseCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {profitDenseCount} strong
          </Badge>
        )}
        {isLowSample && (
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
        )}
      </div>
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            <p className="font-medium">Profit Score: {score.toFixed(1)} / 10</p>
            <p className="text-muted-foreground">
              Based on your dealership outcomes + fingerprint stats + geography
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 border-t border-border">
              <span className="text-muted-foreground">Sample size:</span>
              <span className="font-mono">n={sampleSize}</span>
              {medianGp !== null && medianGp !== undefined && (
                <>
                  <span className="text-muted-foreground">Median GP:</span>
                  <span className="font-mono">${medianGp.toLocaleString()}</span>
                </>
              )}
              <span className="text-muted-foreground">High-profit lots:</span>
              <span className="font-mono">{profitDenseCount}</span>
            </div>
            {isLowSample && (
              <p className="text-muted-foreground italic pt-1">
                ⚠️ Low sample confidence — score capped at 6.0
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Simple heat indicator for fallback (count-based)
interface SimpleHeatIndicatorProps {
  matchingLots: number;
}

export function SimpleHeatIndicator({ matchingLots }: SimpleHeatIndicatorProps) {
  const getHeatLevel = (count: number) => {
    if (count >= 8) return 'hot';
    if (count >= 3) return 'warm';
    return 'cold';
  };

  const heat = getHeatLevel(matchingLots);
  
  const config = {
    hot: { icon: Flame, className: 'text-primary' },
    warm: { icon: Thermometer, className: 'text-muted-foreground' },
    cold: { icon: Snowflake, className: 'text-muted-foreground/60' },
  };
  
  const { icon: Icon, className } = config[heat];
  
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{matchingLots} relevant</span>
    </div>
  );
}
