import { ReactNode } from 'react';
import { OperatorSidebar } from './OperatorSidebar';

interface OperatorLayoutProps {
  children: ReactNode;
}

/**
 * OperatorLayout - Layout wrapper for Operator Mode pages.
 * Uses OperatorSidebar instead of AppSidebar.
 * No Bob Avatar/Panel in operator mode (backend focus).
 */
export function OperatorLayout({ children }: OperatorLayoutProps) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <OperatorSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
