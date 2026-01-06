import { LiquidityTier } from '@/types/geoLiquidity';
import { Badge } from '@/components/ui/badge';
import { Droplets, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GeoLiquidityBadgeProps {
  tier: LiquidityTier;
  reason?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * GeoLiquidityBadge - Displays a liquidity tier badge.
 * Only renders when geo-liquidity feature is visible (checked by parent).
 */
export function GeoLiquidityBadge({
  tier,
  reason,
  showIcon = true,
  size = 'sm',
  className,
}: GeoLiquidityBadgeProps) {
  const config = getTierConfig(tier);
  
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 12 : 14;
  
  return (
    <Badge
      variant="outline"
      className={cn(
        config.className,
        size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2 py-0.5',
        className
      )}
      title={reason || config.label}
    >
      {showIcon && <Icon className="mr-1" size={iconSize} />}
      {config.label}
    </Badge>
  );
}

function getTierConfig(tier: LiquidityTier) {
  switch (tier) {
    case 'HIGH':
      return {
        label: 'High Liquidity',
        icon: TrendingUp,
        className: 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400',
      };
    case 'MEDIUM':
      return {
        label: 'Medium Liquidity',
        icon: Droplets,
        className: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      };
    case 'LOW':
      return {
        label: 'Low Liquidity',
        icon: TrendingDown,
        className: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400',
      };
    case 'UNKNOWN':
    default:
      return {
        label: 'Unknown',
        icon: HelpCircle,
        className: 'border-muted-foreground bg-muted/50 text-muted-foreground',
      };
  }
}
