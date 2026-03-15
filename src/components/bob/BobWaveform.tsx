import { cn } from '@/lib/utils';

interface BobWaveformProps {
  active: boolean;
  className?: string;
  bars?: number;
}

export function BobWaveform({ active, className, bars = 5 }: BobWaveformProps) {
  return (
    <div className={cn("flex items-center gap-[3px] h-6", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-foreground/60 transition-all duration-150",
            active ? "animate-waveform" : "h-1"
          )}
          style={active ? {
            animationDelay: `${i * 120}ms`,
            animationDuration: `${600 + (i % 3) * 200}ms`,
          } : undefined}
        />
      ))}
    </div>
  );
}
