import { cn } from '@/lib/utils';
import { useRef, useEffect, useState } from 'react';
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
 * Lazy video component that only loads when visible
 * Prevents iOS memory crashes from multiple simultaneous video elements
 */
function LazyVideo({ 
  src, 
  size, 
  aspectRatio = 1,
  className 
}: { 
  src: string; 
  size: number; 
  aspectRatio?: number;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isVisible) {
      video.play().catch(() => {
        // Autoplay blocked - silent fail
      });
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [isVisible]);

  return (
    <div 
      ref={containerRef} 
      style={{ width: size, height: size * aspectRatio }}
      className={className}
    >
      {isVisible ? (
        <video
          ref={videoRef}
          src={src}
          loop
          muted
          playsInline
          preload="none"
          width={size}
          height={size * aspectRatio}
          className="object-contain w-full h-full"
        />
      ) : (
        <img
          src={kitingWingMark}
          alt="Kiting"
          width={size}
          height={size * aspectRatio}
          className="object-contain w-full h-full"
        />
      )}
    </div>
  );
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
  
  // Use lazy video version for animated display
  if (useVideo) {
    return (
      <LazyVideo
        src={kitingWingAnimated}
        size={size}
        aspectRatio={0.67}
        className={cn('object-contain', className)}
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
 * Animated video version of the logo - uses lazy loading
 */
export function KitingWingMarkVideo({ 
  size = 80,
  className
}: { size?: number; className?: string }) {
  return (
    <LazyVideo
      src={kitingWingAnimated}
      size={size}
      aspectRatio={1}
      className={cn('rounded-lg', className)}
    />
  );
}

/**
 * Static export for favicon/app icon use
 * Path to the actual logo image
 */
export const KITING_WING_MARK_PATH = '/assets/kiting-wing-mark.jpg';
