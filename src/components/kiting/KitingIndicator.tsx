import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KitingWingMark } from './KitingWingMark';

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
  sm: { icon: 28, container: 'w-10 h-8', text: 'text-xs', gap: 'gap-2' },
  md: { icon: 40, container: 'w-14 h-10', text: 'text-sm', gap: 'gap-2.5' },
  lg: { icon: 56, container: 'w-20 h-14', text: 'text-sm', gap: 'gap-3' },
  xl: { icon: 80, container: 'w-28 h-20', text: 'text-base', gap: 'gap-4' },
};

/**
 * Animated Kiting Mode indicator with wing mark logo
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

  return (
    <div className={cn('flex items-center', sizeConfig.gap, className)}>
      {/* Animated container */}
      <div className={cn(
        'relative rounded-lg flex items-center justify-center transition-all duration-300',
        sizeConfig.container,
        config.bgColor,
        'motion-reduce:animate-none'
      )}>
        {/* Outer ring pulse for active states */}
        {!subtle && (state === 'scanning' || state === 'diving' || state === 'strike') && (
          <div className={cn(
            'absolute inset-[-4px] rounded-lg border-2 animate-ping opacity-50 motion-reduce:animate-none',
            config.ringColor
          )} />
        )}
        
        {/* Radar sweep for scanning */}
        {!subtle && state === 'scanning' && (
          <div className="absolute inset-0 rounded-lg overflow-hidden motion-reduce:hidden">
            <div className="absolute inset-0 animate-kiting-radar" 
              style={{ background: 'conic-gradient(from 0deg, transparent, hsl(217 91% 60% / 0.25), transparent)' }}
            />
          </div>
        )}

        {/* Wing Mark SVG */}
        <KitingWingMark 
          state={state}
          size={sizeConfig.icon}
          animated={!subtle}
          className={cn(
            config.color,
            'relative z-10',
            state === 'hovering' && 'animate-kiting-hover',
            state === 'scanning' && 'animate-kiting-scan',
            state === 'diving' && 'animate-kiting-dive',
            state === 'strike' && 'animate-kiting-strike'
          )}
        />

        {/* Strike flash effect */}
        {!subtle && state === 'strike' && (
          <div className="absolute inset-0 rounded-lg bg-emerald-400/60 animate-kiting-flash motion-reduce:hidden" />
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
      <KitingWingMark 
        state={state} 
        size={16} 
        animated={state !== 'idle'}
        className={cn(
          config.color,
          state === 'scanning' && 'animate-pulse',
          state === 'strike' && 'animate-bounce'
        )}
      />
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
