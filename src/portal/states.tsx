import { Button } from "@/components/ui/button";

export function PortalLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3" data-testid="portal-loading">
      <p className="text-sm text-neutral-500">{label}</p>
      <div className="h-40 animate-pulse bg-neutral-100" />
      <div className="h-40 animate-pulse bg-neutral-100" />
    </div>
  );
}

export function PortalError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border border-neutral-300 bg-neutral-50 p-4" data-testid="portal-error">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 text-sm text-neutral-600">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PortalEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-neutral-300 p-8 text-center" data-testid="portal-empty">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-neutral-600">{body}</p>
    </div>
  );
}

export function UnderFloor({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  return (
    <p className="text-[#117A3A] font-semibold" data-testid="under-floor">
      {pct.toFixed(1)}% under floor
    </p>
  );
}

export function SyntheticMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex border border-neutral-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
      Synthetic example
    </span>
  );
}
