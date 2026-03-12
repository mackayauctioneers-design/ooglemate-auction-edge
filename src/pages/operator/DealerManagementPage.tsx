import { DealerOnboarding } from '@/components/admin/DealerOnboarding';
import { OperatorShell } from '@/components/operator/OperatorShell';

export default function DealerManagementPage() {
  return (
    <OperatorShell title="Dealer Management" subtitle="Onboard and manage dealer profiles">
      <div className="max-w-2xl mx-auto">
        <DealerOnboarding />
      </div>
    </OperatorShell>
  );
}
