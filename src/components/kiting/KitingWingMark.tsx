import { cn } from '@/lib/utils';
import type { KitingState } from './KitingIndicator';
import kitingWingMark from '@/assets/kiting-wing-mark.jpg';
import kitingWingAnimated from '@/assets/kiting-wing-animated.mp4';

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
 * Uses the official Kiting logo - supports static image or animated video.
 * Supports dynamic sizing and animation states.
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
  
  // Use video version for animated display
  if (useVideo) {
    return (
      <video
        src={kitingWingAnimated}
        autoPlay
        loop
        muted
        playsInline
        width={size}
        height={size * 0.67}
        className={cn(
          'object-contain',
          className
        )}
      />
    );
  }
  
  return (
    <img
      src={kitingWingMark}
      alt={`Kiting Mode: ${state}`}
      width={size}
      height={size * 0.67}
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
 * Animated video version of the logo
 */
export function KitingWingMarkVideo({ 
  size = 80,
  className
}: { size?: number; className?: string }) {
  return (
    <video
      src={kitingWingAnimated}
      autoPlay
      loop
      muted
      playsInline
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
