import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { DealerOnboarding } from '@/components/admin/DealerOnboarding';
import { Button } from '@/components/ui/button';
import { BarChart3 } from 'lucide-react';

export default function DealerManagementPage() {
  const navigate = useNavigate();

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

        {/* AJH Report Card */}
        <div className="rounded-lg border border-border bg-card p-5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">AJH Auto Traders</h3>
            <p className="text-sm text-muted-foreground mt-0.5">696 sales analyzed · 85% win rate · $642K total profit</p>
          </div>
          <Button onClick={() => navigate('/dealer/report/ajh')} className="gap-2">
            <BarChart3 className="h-4 w-4" /> View Report
          </Button>
        </div>

        <DealerOnboarding />
      </div>
    </OperatorLayout>
  );
}