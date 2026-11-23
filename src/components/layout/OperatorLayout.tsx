import { ReactNode } from 'react';
import { OperatorSidebar } from './OperatorSidebar';
import { useIsNestedLayout, LayoutNestingProvider } from './LayoutContext';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

interface OperatorLayoutProps {
  children: ReactNode;
  desk?: boolean;
}

/**
 * OperatorLayout - Layout wrapper for Operator Mode pages.
 * Uses OperatorSidebar instead of AppSidebar.
 * No Bob Avatar/Panel in operator mode (backend focus).
 * Skips sidebar rendering when nested inside another layout (e.g. tabbed pages).
 */
export function OperatorLayout({ children, desk = false }: OperatorLayoutProps) {
  const isNested = useIsNestedLayout();

  if (isNested) return <>{children}</>;

  return (
    <LayoutNestingProvider value={true}>
      <div className="relative flex min-h-screen w-full bg-background">
        {desk ? <><div className="hidden shrink-0 lg:block"><OperatorSidebar /></div><div className="absolute left-3 top-3 z-30 lg:hidden"><Sheet><SheetTrigger asChild><Button variant="outline" size="icon" aria-label="Open operator navigation"><Menu /></Button></SheetTrigger><SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Operator navigation</SheetTitle><OperatorSidebar /></SheetContent></Sheet></div></> : <OperatorSidebar />}
        <main className="min-w-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </LayoutNestingProvider>
  );
}
