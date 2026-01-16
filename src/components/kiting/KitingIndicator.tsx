import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export type KitingState = 'idle' | 'hovering' | 'scanning' | 'diving' | 'strike';

interface KitingIndicatorProps {
  state?: KitingState;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  subtle?: boolean;
  className?: string;
}

const STATE_CONFIG = {
  idle: {
    label: 'Idle',
    sublabel: 'No active hunts',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    pulseColor: '',
    ringColor: '',
  },
  hovering: {
    label: 'Watching',
    sublabel: 'Monitoring the market',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    pulseColor: '',
    ringColor: '',
  },
  scanning: {
    label: 'Scanning',
    sublabel: 'Searching live feeds...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    pulseColor: 'bg-blue-500/20',
    ringColor: 'border-blue-400',
  },
  diving: {
    label: 'Target Found',
    sublabel: 'Evaluating candidate...',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    pulseColor: 'bg-orange-500/20',
    ringColor: 'border-orange-400',
  },
  strike: {
    label: 'Strike!',
    sublabel: 'Prey captured',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    pulseColor: 'bg-emerald-500/30',
    ringColor: 'border-emerald-400',
  },
};

const SIZE_CONFIG = {
  sm: { icon: 'w-5 h-5', container: 'w-8 h-8', text: 'text-xs', gap: 'gap-2' },
  md: { icon: 'w-7 h-7', container: 'w-10 h-10', text: 'text-sm', gap: 'gap-2.5' },
  lg: { icon: 'w-10 h-10', container: 'w-14 h-14', text: 'text-sm', gap: 'gap-3' },
  xl: { icon: 'w-14 h-14', container: 'w-20 h-20', text: 'text-base', gap: 'gap-4' },
};

/**
 * Animated Kiting Mode indicator with eagle logo
 * States: idle | hovering | scanning | diving | strike
 * Respects prefers-reduced-motion
 */
export function KitingIndicator({ 
  state = 'hovering', 
  size = 'md',
  showLabel = true,
  subtle = false,
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
    <div className={cn('flex items-center', sizeConfig.gap, className)}>
      {/* Animated container */}
      <div className={cn(
        'relative rounded-full flex items-center justify-center transition-all duration-300',
        sizeConfig.container,
        config.bgColor,
        // Reduced motion: just show static icon with color
        'motion-reduce:animate-none'
      )}>
        {/* Outer ring pulse for active states */}
        {!subtle && (state === 'scanning' || state === 'diving' || state === 'strike') && (
          <div className={cn(
            'absolute inset-[-4px] rounded-full border-2 animate-ping opacity-50 motion-reduce:animate-none',
            config.ringColor
          )} />
        )}
        
        {/* Radar sweep for scanning */}
        {!subtle && state === 'scanning' && (
          <div className="absolute inset-0 rounded-full overflow-hidden motion-reduce:hidden">
            <div className="absolute inset-0 animate-kiting-radar bg-gradient-conic from-transparent via-blue-400/40 to-transparent" 
              style={{ background: 'conic-gradient(from 0deg, transparent, rgba(59, 130, 246, 0.3), transparent)' }}
            />
          </div>
        )}

        {/* Eagle SVG Icon */}
        <svg
          viewBox="0 0 100 80"
          className={cn(
            sizeConfig.icon,
            config.color,
            !subtle && animationClass,
            'transition-colors duration-300 relative z-10',
            'motion-reduce:animate-none'
          )}
          fill="currentColor"
          aria-label={`Kiting Mode: ${config.label}`}
        >
          {/* Left Wing */}
          <path
            className={cn(
              'origin-[30%_60%] transition-transform motion-reduce:transform-none',
              !subtle && state === 'hovering' && 'animate-wing-flap-left',
              !subtle && state === 'scanning' && 'animate-wing-flap-left-fast',
              !subtle && state === 'diving' && 'animate-wing-tuck-left'
            )}
            d="M0 35 C5 25, 15 15, 30 10 C35 15, 38 25, 40 35 C35 40, 25 45, 15 50 C10 45, 5 40, 0 35 Z"
          />
          {/* Left Wing feather lines */}
          <path
            className={cn(
              'origin-[30%_60%] transition-transform motion-reduce:transform-none',
              !subtle && state === 'hovering' && 'animate-wing-flap-left',
              !subtle && state === 'scanning' && 'animate-wing-flap-left-fast',
              !subtle && state === 'diving' && 'animate-wing-tuck-left'
            )}
            d="M8 32 L15 28 M12 36 L20 30 M16 40 L25 33"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity="0.5"
          />
          
          {/* Right Wing */}
          <path
            className={cn(
              'origin-[70%_60%] transition-transform motion-reduce:transform-none',
              !subtle && state === 'hovering' && 'animate-wing-flap-right',
              !subtle && state === 'scanning' && 'animate-wing-flap-right-fast',
              !subtle && state === 'diving' && 'animate-wing-tuck-right'
            )}
            d="M100 35 C95 25, 85 15, 70 10 C65 15, 62 25, 60 35 C65 40, 75 45, 85 50 C90 45, 95 40, 100 35 Z"
          />
          {/* Right Wing feather lines */}
          <path
            className={cn(
              'origin-[70%_60%] transition-transform motion-reduce:transform-none',
              !subtle && state === 'hovering' && 'animate-wing-flap-right',
              !subtle && state === 'scanning' && 'animate-wing-flap-right-fast',
              !subtle && state === 'diving' && 'animate-wing-tuck-right'
            )}
            d="M92 32 L85 28 M88 36 L80 30 M84 40 L75 33"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity="0.5"
          />
          
          {/* Body/Head */}
          <path
            className={cn(
              'transition-transform motion-reduce:transform-none',
              !subtle && state === 'diving' && 'animate-kiting-body-dive'
            )}
            d="M45 35 C45 30, 48 25, 50 22 C52 25, 55 30, 55 35 
               C55 50, 52 60, 50 70 C48 60, 45 50, 45 35 Z"
          />
          {/* Eye */}
          <circle cx="50" cy="30" r="2" className="opacity-70" />
        </svg>

        {/* Strike flash effect */}
        {!subtle && state === 'strike' && (
          <div className="absolute inset-0 rounded-full bg-emerald-400/60 animate-kiting-flash motion-reduce:hidden" />
        )}
        
        {/* Strike badge - stays visible for 10 min after strike */}
        {state === 'strike' && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Label */}
      {showLabel && (
        <div className="flex flex-col min-w-0">
          <span className={cn('font-semibold truncate', sizeConfig.text, config.color)}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground truncate">
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
  showText = true,
  className 
}: { state?: KitingState; showText?: boolean; className?: string }) {
  const config = STATE_CONFIG[state];
  
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className={cn(
        'w-2 h-2 rounded-full',
        state === 'idle' && 'bg-muted-foreground/50',
        state === 'hovering' && 'bg-primary animate-pulse motion-reduce:animate-none',
        state === 'scanning' && 'bg-blue-500 animate-ping motion-reduce:animate-pulse',
        state === 'diving' && 'bg-orange-500 animate-bounce motion-reduce:animate-none',
        state === 'strike' && 'bg-emerald-500 animate-pulse motion-reduce:animate-none'
      )} />
      {showText && (
        <span className={cn('text-xs font-medium', config.color)}>
          {config.label}
        </span>
      )}
    </div>
  );
}

/**
 * Text-only state indicator for inline use
 */
export function KitingStateText({ state = 'hovering' }: { state?: KitingState }) {
  const config = STATE_CONFIG[state];
  
  const stateMessages: Record<KitingState, string> = {
    idle: 'Kiting Mode inactive',
    hovering: 'Kiting — waiting for exposure',
    scanning: 'Scanning market now',
    diving: 'Candidate spotted — evaluating',
    strike: 'Strike detected — alert issued',
  };

  return (
    <span className={cn('text-sm font-medium', config.color)}>
      {stateMessages[state]}
    </span>
  );
}
