import { cn } from '@/lib/utils';
import type { KitingState } from './KitingIndicator';

interface KitingWingMarkProps {
  state?: KitingState;
  size?: number;
  className?: string;
  animated?: boolean;
}

/**
 * Kiting Wing Mark SVG
 * 
 * Sharp angular raptor wings with central tail element.
 * Based on the Karugul wing emblem design.
 * Uses currentColor for theming (default: #1F2933 dark charcoal)
 * Supports dynamic color via CSS fill: currentColor
 * 
 * Animation states:
 * - static: No animation (idle)
 * - active: Subtle wing expansion/micro-flutter
 */
export function KitingWingMark({ 
  state = 'hovering',
  size = 40,
  className,
  animated = true
}: KitingWingMarkProps) {
  const isActive = state !== 'idle';
  const isScanning = state === 'scanning';
  const isDiving = state === 'diving';
  const isStrike = state === 'strike';
  
  return (
    <svg
      viewBox="0 0 120 80"
      width={size}
      height={size * 0.67}
      className={cn(
        'transition-colors duration-300',
        'motion-reduce:animate-none motion-reduce:transform-none',
        className
      )}
      fill="currentColor"
      aria-label={`Kiting Mode: ${state}`}
      role="img"
    >
      {/* Left Wing - Sharp angular design */}
      <g 
        className={cn(
          'origin-[60px_65px] transition-transform',
          animated && isActive && !isDiving && 'animate-wing-left',
          animated && isScanning && 'animate-wing-left-fast',
          animated && isDiving && 'animate-wing-dive-left',
          animated && isStrike && 'animate-wing-strike'
        )}
      >
        {/* Primary wing feathers */}
        <path d="M60 65 L0 25 L8 30 L15 28 L22 32 L28 30 L35 35 L42 33 L48 40 L55 45 L60 55 Z" />
        {/* Secondary wing layer for depth */}
        <path 
          d="M60 60 L25 38 L32 40 L40 42 L48 46 L55 52 L60 58 Z" 
          opacity="0.7"
        />
      </g>

      {/* Right Wing - Mirrored sharp angular design */}
      <g 
        className={cn(
          'origin-[60px_65px] transition-transform',
          animated && isActive && !isDiving && 'animate-wing-right',
          animated && isScanning && 'animate-wing-right-fast',
          animated && isDiving && 'animate-wing-dive-right',
          animated && isStrike && 'animate-wing-strike'
        )}
      >
        {/* Primary wing feathers */}
        <path d="M60 65 L120 25 L112 30 L105 28 L98 32 L92 30 L85 35 L78 33 L72 40 L65 45 L60 55 Z" />
        {/* Secondary wing layer for depth */}
        <path 
          d="M60 60 L95 38 L88 40 L80 42 L72 46 L65 52 L60 58 Z" 
          opacity="0.7"
        />
      </g>

      {/* Center Tail */}
      <path 
        className={cn(
          'origin-[60px_55px] transition-transform',
          animated && isDiving && 'animate-tail-dive',
          animated && isStrike && 'animate-tail-strike'
        )}
        d="M56 55 L60 80 L64 55 L62 45 L60 42 L58 45 Z"
      />
      
      {/* Tail accent lines */}
      <path 
        d="M58 50 L60 75 M62 50 L60 75"
        stroke="currentColor"
        strokeWidth="0.5"
        fill="none"
        opacity="0.3"
        className="motion-reduce:hidden"
      />
    </svg>
  );
}

/**
 * Static export for favicon/app icon use
 * Clean SVG string - no animations
 */
export const KITING_WING_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" fill="currentColor">
  <path d="M60 65 L0 25 L8 30 L15 28 L22 32 L28 30 L35 35 L42 33 L48 40 L55 45 L60 55 Z"/>
  <path d="M60 60 L25 38 L32 40 L40 42 L48 46 L55 52 L60 58 Z" opacity="0.7"/>
  <path d="M60 65 L120 25 L112 30 L105 28 L98 32 L92 30 L85 35 L78 33 L72 40 L65 45 L60 55 Z"/>
  <path d="M60 60 L95 38 L88 40 L80 42 L72 46 L65 52 L60 58 Z" opacity="0.7"/>
  <path d="M56 55 L60 80 L64 55 L62 45 L60 42 L58 45 Z"/>
</svg>`;
