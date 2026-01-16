import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export type KitingState = 'idle' | 'hovering' | 'scanning' | 'diving' | 'strike';

interface KitingIndicatorProps {
  state?: KitingState;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  className?: string;
}

const STATE_CONFIG = {
  idle: {
    label: 'Idle',
    sublabel: 'No active hunts',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    pulseColor: '',
  },
  hovering: {
    label: 'Watching',
    sublabel: 'Monitoring the market',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    pulseColor: '',
  },
  scanning: {
    label: 'Scanning',
    sublabel: 'Searching live feeds...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    pulseColor: 'bg-blue-500/20',
  },
  diving: {
    label: 'Target Found',
    sublabel: 'Evaluating match...',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    pulseColor: 'bg-orange-500/20',
  },
  strike: {
    label: 'Strike!',
    sublabel: 'Prey captured',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    pulseColor: 'bg-green-500/30',
  },
};

const SIZE_CONFIG = {
  sm: { icon: 'w-6 h-6', container: 'p-1.5', text: 'text-xs' },
  md: { icon: 'w-8 h-8', container: 'p-2', text: 'text-sm' },
  lg: { icon: 'w-12 h-12', container: 'p-3', text: 'text-sm' },
  xl: { icon: 'w-16 h-16', container: 'p-4', text: 'text-base' },
};

/**
 * Animated Kiting Mode indicator with eagle logo
 * States: idle | hovering | scanning | diving | strike
 */
export function KitingIndicator({ 
  state = 'hovering', 
  size = 'md',
  showLabel = true,
  className 
}: KitingIndicatorProps) {
  const config = STATE_CONFIG[state];
  const sizeConfig = SIZE_CONFIG[size];

  const animationClass = useMemo(() => {
    switch (state) {
      case 'idle':
        return '';
      case 'hovering':
        return 'animate-kiting-hover';
      case 'scanning':
        return 'animate-kiting-scan';
      case 'diving':
        return 'animate-kiting-dive';
      case 'strike':
        return 'animate-kiting-strike';
      default:
        return '';
    }
  }, [state]);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Animated container */}
      <div className={cn(
        'relative rounded-full flex items-center justify-center transition-all duration-300',
        sizeConfig.container,
        config.bgColor
      )}>
        {/* Pulse ring for active states */}
        {(state === 'scanning' || state === 'diving' || state === 'strike') && (
          <div className={cn(
            'absolute inset-0 rounded-full animate-ping opacity-75',
            config.pulseColor
          )} />
        )}
        
        {/* Radar sweep for scanning */}
        {state === 'scanning' && (
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div className="absolute inset-0 animate-kiting-radar bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
          </div>
        )}

        {/* Eagle SVG Icon */}
        <svg
          viewBox="0 0 100 80"
          className={cn(
            sizeConfig.icon,
            config.color,
            animationClass,
            'transition-colors duration-300 relative z-10'
          )}
          fill="currentColor"
        >
          {/* Left Wing */}
          <path
            className={cn(
              'origin-[30%_60%] transition-transform',
              state === 'hovering' && 'animate-wing-flap-left',
              state === 'scanning' && 'animate-wing-flap-left-fast',
              state === 'diving' && 'animate-wing-tuck-left'
            )}
            d="M0 35 C5 25, 15 15, 30 10 C35 15, 38 25, 40 35 C35 40, 25 45, 15 50 C10 45, 5 40, 0 35 Z
               M8 32 L15 28 M12 36 L20 30 M16 40 L25 33"
          />
          
          {/* Right Wing */}
          <path
            className={cn(
              'origin-[70%_60%] transition-transform',
              state === 'hovering' && 'animate-wing-flap-right',
              state === 'scanning' && 'animate-wing-flap-right-fast',
              state === 'diving' && 'animate-wing-tuck-right'
            )}
            d="M100 35 C95 25, 85 15, 70 10 C65 15, 62 25, 60 35 C65 40, 75 45, 85 50 C90 45, 95 40, 100 35 Z
               M92 32 L85 28 M88 36 L80 30 M84 40 L75 33"
          />
          
          {/* Body/Head */}
          <path
            className={cn(
              state === 'diving' && 'animate-kiting-body-dive'
            )}
            d="M45 35 C45 30, 48 25, 50 22 C52 25, 55 30, 55 35 
               C55 50, 52 60, 50 70 C48 60, 45 50, 45 35 Z
               M48 28 C49 26, 51 26, 52 28"
          />
        </svg>

        {/* Strike flash effect */}
        {state === 'strike' && (
          <div className="absolute inset-0 rounded-full bg-green-400/50 animate-kiting-flash" />
        )}
      </div>

      {/* Label */}
      {showLabel && (
        <div className="flex flex-col">
          <span className={cn('font-semibold', sizeConfig.text, config.color)}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {config.sublabel}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for cards/lists
 */
export function KitingIndicatorCompact({ 
  state = 'hovering',
  className 
}: { state?: KitingState; className?: string }) {
  const config = STATE_CONFIG[state];
  
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className={cn(
        'w-2 h-2 rounded-full',
        state === 'idle' && 'bg-muted-foreground/50',
        state === 'hovering' && 'bg-muted-foreground animate-pulse',
        state === 'scanning' && 'bg-blue-500 animate-ping',
        state === 'diving' && 'bg-orange-500 animate-bounce',
        state === 'strike' && 'bg-green-500 animate-pulse'
      )} />
      <span className={cn('text-xs font-medium', config.color)}>
        {config.label}
      </span>
    </div>
  );
}
