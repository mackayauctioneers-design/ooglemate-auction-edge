import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function OperatorDashboardPage() {
  useEffect(() => {
    document.title = 'Operator Dashboard | OogleMate';
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operator Dashboard</h1>
          <p className="text-muted-foreground">Backend monitoring and controls</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">Ingestion Health, Cron Audit, Job Queue</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Data Ops</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">Traps, Preflight, Validation</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">Feeding Mode, Fingerprints</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Admin</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">Onboarding, Flags, Settings</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </OperatorLayout>
  );
}
