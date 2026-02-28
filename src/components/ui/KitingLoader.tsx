/**
 * KitingLoader — thin wrapper around KitingIndicator for use as a loading state.
 * Uses the existing kiting system (KitingWingMark + KitingIndicator) so the
 * same logo asset and animation states are consistent across the app.
 *
 * Usage:
 *   <KitingLoader state="scanning" label="Searching dealer sites…" />
 */

import { KitingIndicator, type KitingState } from "@/components/kiting/KitingIndicator";

interface KitingLoaderProps {
  state?: KitingState;
  size?: "sm" | "md" | "lg" | "xl";
  label?: string;
  className?: string;
}

export function KitingLoader({
  state = "scanning",
  size = "md",
  label,
  className = "",
}: KitingLoaderProps) {
  return (
    <div className={`flex flex-col items-center gap-2 py-2 ${className}`}>
      <KitingIndicator state={state} size={size} showLabel={false} />
      {label && (
        <p className="text-xs text-muted-foreground text-center animate-pulse max-w-[200px]">
          {label}
        </p>
      )}
    </div>
  );
}
