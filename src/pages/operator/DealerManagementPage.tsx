import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { DealerOnboarding } from '@/components/admin/DealerOnboarding';

export default function DealerManagementPage() {
  useEffect(() => {
    document.title = 'Dealer Management | Operator';
  }, []);

  return (
    <OperatorLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealer Management</h1>
          <p className="text-muted-foreground mt-1">Onboard and link dealer profiles</p>
        </div>
        <DealerOnboarding />
      </div>
    </OperatorLayout>
  );
}
