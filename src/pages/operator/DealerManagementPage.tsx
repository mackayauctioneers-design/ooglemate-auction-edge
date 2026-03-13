import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { DealerOnboarding } from '@/components/admin/DealerOnboarding';
import { Button } from '@/components/ui/button';
import { BarChart3, Eye } from 'lucide-react';

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

        {/* Demo Dashboard Card */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">Dealer Demo Dashboard</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Preview the demo experience dealers see — live fingerprints, opportunities & intelligence</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/dealer/demo-dashboard')} className="gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
            <Eye className="h-4 w-4" /> View Demo
          </Button>
        </div>

        <DealerOnboarding />
      </div>
    </OperatorLayout>
  );
}