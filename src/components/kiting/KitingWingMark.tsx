import { cn } from '@/lib/utils';
import type { KitingState } from './KitingIndicator';
import kitingWingMark from '@/assets/kiting-wing-mark.jpg';

interface KitingWingMarkProps {
  state?: KitingState;
  size?: number;
  className?: string;
  animated?: boolean;
  useVideo?: boolean;
}

/**
 * Kiting Wing Mark
 * 
 * Uses the official Kiting logo - static image only to prevent iOS crashes.
 * Video playback has been disabled due to memory issues on mobile devices.
 * 
 * Animation states:
 * - static: No animation (idle)
 * - active: Subtle pulse animation
 */
export function KitingWingMark({ 
  state = 'hovering',
  size = 40,
  className,
  animated = true,
  useVideo = false
}: KitingWingMarkProps) {
  const isActive = state !== 'idle';
  const isScanning = state === 'scanning';
  const isDiving = state === 'diving';
  const isStrike = state === 'strike';
  
  return (
    <img
      src={kitingWingMark}
      alt={`Kiting Mode: ${state}`}
      width={size}
      height={useVideo ? size : size * 0.67}
      className={cn(
        'object-contain transition-all duration-300',
        'motion-reduce:animate-none motion-reduce:transform-none',
        animated && isActive && !isDiving && !isStrike && 'animate-pulse',
        animated && isScanning && 'animate-[pulse_0.5s_ease-in-out_infinite]',
        animated && isDiving && 'animate-[pulse_0.3s_ease-in-out_infinite] scale-110',
        animated && isStrike && 'animate-[pulse_0.2s_ease-in-out_3] scale-125',
        className
      )}
    />
  );
}

/**
 * Video version replaced with static image to prevent iOS memory crashes
 */
export function KitingWingMarkVideo({ 
  size = 80,
  className
}: { size?: number; className?: string }) {
  return (
    <img
      src={kitingWingMark}
      alt="Kiting"
      width={size}
      height={size}
      className={cn(
        'object-contain rounded-lg',
        className
      )}
    />
  );
}

/**
 * Static export for favicon/app icon use
 * Path to the actual logo image
 */
export const KITING_WING_MARK_PATH = '/assets/kiting-wing-mark.jpg';
