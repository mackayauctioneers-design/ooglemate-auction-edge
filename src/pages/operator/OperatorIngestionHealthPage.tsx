import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { IngestionHealthContent } from '@/components/operator/IngestionHealthContent';

/**
 * Ingestion Health page for Operator Mode.
 */
export default function OperatorIngestionHealthPage() {
  useEffect(() => {
    document.title = 'Ingestion Health | Operator';
  }, []);

  return (
    <OperatorLayout>
      <IngestionHealthContent />
    </OperatorLayout>
  );
}
