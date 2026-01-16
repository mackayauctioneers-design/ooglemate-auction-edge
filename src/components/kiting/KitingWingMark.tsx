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
 * Symmetrical raptor wings with central tail element.
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
      viewBox="0 0 100 60"
      width={size}
      height={size * 0.6}
      className={cn(
        'transition-colors duration-300',
        'motion-reduce:animate-none motion-reduce:transform-none',
        className
      )}
      fill="currentColor"
      aria-label={`Kiting Mode: ${state}`}
      role="img"
    >
      {/* Left Wing */}
      <g 
        className={cn(
          'origin-[50%_100%] transition-transform',
          animated && isActive && !isDiving && 'animate-wing-left',
          animated && isScanning && 'animate-wing-left-fast',
          animated && isDiving && 'animate-wing-dive-left',
          animated && isStrike && 'animate-wing-strike'
        )}
      >
        {/* Main wing shape */}
        <path d="M50 55 
          C45 50, 35 40, 20 35
          C15 33, 8 32, 2 32
          C1 31, 0 30, 0 29
          C0 28, 1 27, 3 27
          C10 26, 18 24, 25 20
          C32 16, 38 12, 42 8
          C44 6, 46 5, 48 5
          C49 5, 50 6, 50 8
          C50 15, 50 30, 50 55
          Z" 
        />
        {/* Wing feather details */}
        <path 
          d="M15 30 L25 25 M10 31 L18 28 M22 28 L30 22 M28 24 L35 18 M34 20 L40 14"
          stroke="currentColor"
          strokeWidth="0.8"
          fill="none"
          opacity="0.3"
          className="motion-reduce:hidden"
        />
      </g>

      {/* Right Wing (mirrored) */}
      <g 
        className={cn(
          'origin-[50%_100%] transition-transform',
          animated && isActive && !isDiving && 'animate-wing-right',
          animated && isScanning && 'animate-wing-right-fast',
          animated && isDiving && 'animate-wing-dive-right',
          animated && isStrike && 'animate-wing-strike'
        )}
      >
        {/* Main wing shape */}
        <path d="M50 55 
          C55 50, 65 40, 80 35
          C85 33, 92 32, 98 32
          C99 31, 100 30, 100 29
          C100 28, 99 27, 97 27
          C90 26, 82 24, 75 20
          C68 16, 62 12, 58 8
          C56 6, 54 5, 52 5
          C51 5, 50 6, 50 8
          C50 15, 50 30, 50 55
          Z" 
        />
        {/* Wing feather details */}
        <path 
          d="M85 30 L75 25 M90 31 L82 28 M78 28 L70 22 M72 24 L65 18 M66 20 L60 14"
          stroke="currentColor"
          strokeWidth="0.8"
          fill="none"
          opacity="0.3"
          className="motion-reduce:hidden"
        />
      </g>

      {/* Center Tail/Body */}
      <path 
        className={cn(
          'origin-[50%_30%] transition-transform',
          animated && isDiving && 'animate-tail-dive',
          animated && isStrike && 'animate-tail-strike'
        )}
        d="M50 8
          C48 12, 47 20, 47 30
          C47 38, 48 48, 50 60
          C52 48, 53 38, 53 30
          C53 20, 52 12, 50 8
          Z"
      />
    </svg>
  );
}

/**
 * Static export for favicon/app icon use
 * No animations, pure SVG string
 */
export const KITING_WING_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" fill="currentColor">
  <path d="M50 55 C45 50, 35 40, 20 35 C15 33, 8 32, 2 32 C1 31, 0 30, 0 29 C0 28, 1 27, 3 27 C10 26, 18 24, 25 20 C32 16, 38 12, 42 8 C44 6, 46 5, 48 5 C49 5, 50 6, 50 8 C50 15, 50 30, 50 55 Z"/>
  <path d="M50 55 C55 50, 65 40, 80 35 C85 33, 92 32, 98 32 C99 31, 100 30, 100 29 C100 28, 99 27, 97 27 C90 26, 82 24, 75 20 C68 16, 62 12, 58 8 C56 6, 54 5, 52 5 C51 5, 50 6, 50 8 C50 15, 50 30, 50 55 Z"/>
  <path d="M50 8 C48 12, 47 20, 47 30 C47 38, 48 48, 50 60 C52 48, 53 38, 53 30 C53 20, 52 12, 50 8 Z"/>
</svg>`;
