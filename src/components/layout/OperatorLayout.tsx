import { ReactNode } from 'react';
import { OperatorSidebar } from './OperatorSidebar';
import { useIsNestedLayout, LayoutNestingProvider } from './LayoutContext';

interface OperatorLayoutProps {
  children: ReactNode;
}

/**
 * OperatorLayout - Layout wrapper for Operator Mode pages.
 * Uses OperatorSidebar instead of AppSidebar.
 * No Bob Avatar/Panel in operator mode (backend focus).
 * Skips sidebar rendering when nested inside another layout (e.g. tabbed pages).
 */
export function OperatorLayout({ children }: OperatorLayoutProps) {
  const isNested = useIsNestedLayout();

  if (isNested) return <>{children}</>;

  return (
    <LayoutNestingProvider value={true}>
      <div className="flex min-h-screen w-full bg-background">
        <OperatorSidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </LayoutNestingProvider>
  );
}
