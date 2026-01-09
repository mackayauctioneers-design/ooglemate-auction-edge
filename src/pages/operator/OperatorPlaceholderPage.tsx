import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function OperatorPlaceholderPage({ title, description }: PlaceholderPageProps) {
  useEffect(() => {
    document.title = `${title} | OogleMate`;
  }, [title]);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center justify-center h-64 border border-dashed border-muted-foreground/30 rounded-lg">
          <p className="text-muted-foreground">Coming soon...</p>
        </div>
      </div>
    </OperatorLayout>
  );
}
