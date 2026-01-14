import { Snowflake, AlertTriangle, Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ============================================================================
// HEAT TIER SYSTEM - Single source of truth
// ============================================================================
// Cold: 0-1 relevant
// Warm: 2-4 relevant
// Hot: 5-9 relevant
// Very Hot: 10+ relevant
// ============================================================================

export type HeatTier = 'cold' | 'warm' | 'hot' | 'very-hot';

const TIER_THRESHOLDS = {
  warm: 2,
  hot: 5,
  veryHot: 10,
} as const;

export function getHeatTier(relevantCount: number): HeatTier {
  if (relevantCount >= TIER_THRESHOLDS.veryHot) return 'very-hot';
  if (relevantCount >= TIER_THRESHOLDS.hot) return 'hot';
  if (relevantCount >= TIER_THRESHOLDS.warm) return 'warm';
  return 'cold';
}

// Style map for consistent styling across badge, strip, and card
export const HEAT_TIER_STYLES = {
  cold: {
    stripClass: 'bg-muted-foreground/60',
    badgeBg: 'bg-muted',
    badgeText: 'text-muted-foreground',
    badgeBorder: 'border-border',
    glowClass: '',
    stripWidth: 'w-1.5',
  },
  warm: {
    stripClass: 'bg-amber-500',
    badgeBg: 'bg-amber-500',
    badgeText: 'text-black',
    badgeBorder: 'border-amber-400',
    glowClass: 'shadow-[0_0_10px_rgba(245,158,11,0.2)]',
    stripWidth: 'w-1.5',
  },
  hot: {
    stripClass: 'bg-orange-500',
    badgeBg: 'bg-orange-500',
    badgeText: 'text-black',
    badgeBorder: 'border-orange-400',
    glowClass: 'shadow-[0_0_14px_rgba(249,115,22,0.25)]',
    stripWidth: 'w-2',
  },
  'very-hot': {
    stripClass: 'bg-red-500',
    badgeBg: 'bg-red-500',
    badgeText: 'text-white',
    badgeBorder: 'border-red-400',
    glowClass: 'shadow-[0_0_18px_rgba(239,68,68,0.3)]',
    stripWidth: 'w-2.5',
  },
} as const;

interface HeatBadgeProps {
  relevantCount: number;
  showTooltip?: boolean;
}

export function HeatBadge({ relevantCount, showTooltip = true }: HeatBadgeProps) {
  const tier = getHeatTier(relevantCount);
  const styles = HEAT_TIER_STYLES[tier];
  
  const tierLabels: Record<HeatTier, string> = {
    cold: 'Cold',
    warm: 'Warm',
    hot: 'Hot',
    'very-hot': 'Very Hot',
  };

  const badge = (
    <div 
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 rounded-md border
        ${styles.badgeBg} ${styles.badgeText} ${styles.badgeBorder}
        font-medium text-xs
      `}
    >
      {tier === 'cold' && <Snowflake className="h-3.5 w-3.5" />}
      {tier === 'warm' && <AlertTriangle className="h-3.5 w-3.5" />}
      {tier === 'hot' && <Flame className="h-3.5 w-3.5" />}
      {tier === 'very-hot' && (
        <>
          <Flame className="h-3.5 w-3.5" />
          <Flame className="h-3.5 w-3.5 -ml-2" />
        </>
      )}
      <span>{relevantCount} relevant</span>
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            <span className="font-semibold">{tierLabels[tier]}</span> — {relevantCount} lots match your profile
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface HeatStripProps {
  relevantCount: number;
}

export function HeatStrip({ relevantCount }: HeatStripProps) {
  const tier = getHeatTier(relevantCount);
  const styles = HEAT_TIER_STYLES[tier];
  
  return (
    <div 
      className={`
        absolute left-0 top-0 bottom-0 
        ${styles.stripWidth} ${styles.stripClass}
        rounded-l-lg
      `}
    />
  );
}

// Card wrapper that applies heat glow
interface HeatCardWrapperProps {
  relevantCount: number;
  children: React.ReactNode;
  className?: string;
}

export function getHeatCardClasses(relevantCount: number): string {
  const tier = getHeatTier(relevantCount);
  const styles = HEAT_TIER_STYLES[tier];
  return styles.glowClass;
}

// Unknown location warning badge
interface LocationWarningProps {
  location: string | null;
}

export function LocationWarningBadge({ location }: LocationWarningProps) {
  const isUnknown = !location || location === 'Unknown';
  
  if (!isUnknown) return null;

  return (
    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted border border-border text-muted-foreground">
      <AlertTriangle className="h-3 w-3" />
      <span>Location Unknown</span>
    </div>
  );
}

// Corner marker for unknown location (small triangle indicator)
export function LocationWarningMarker({ location }: LocationWarningProps) {
  const isUnknown = !location || location === 'Unknown';
  
  if (!isUnknown) return null;

  return (
    <div className="absolute top-0 right-0 w-0 h-0 border-t-[16px] border-t-muted-foreground/50 border-l-[16px] border-l-transparent" />
  );
}
