import { useEffect } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
  Activity,
  Database,
  TrendingUp,
  Fingerprint,
  Target,
  Upload,
  Users,
  Settings
} from 'lucide-react';

export default function OperatorDashboardPage() {
  useEffect(() => {
    document.title = 'Operator Dashboard | OogleMate';
  }, []);

  const sections = [
    {
      title: 'Monitoring',
      items: [
        { label: 'Ingestion Health', path: '/operator/ingestion-health', icon: Activity, desc: 'Pipeline metrics & crawl status' },
        { label: 'Cron Audit Log', path: '/operator/cron-audit', icon: Activity, desc: 'Scheduled task history' },
        { label: 'Trap Health', path: '/operator/trap-health', icon: Activity, desc: 'Failing traps & alerts' },
        { label: 'Job Queue', path: '/operator/job-queue', icon: Activity, desc: 'Background job management' },
      ]
    },
    {
      title: 'Data Ops',
      items: [
        { label: 'VA Intake', path: '/admin-tools/va-intake', icon: Upload, desc: 'Upload auction catalogues' },
        { label: 'Traps Registry', path: '/operator/traps', icon: Database, desc: 'Manage dealer traps' },
        { label: 'Preflight Queue', path: '/operator/preflight', icon: Database, desc: 'Preflight check status' },
      ]
    },
    {
      title: 'Analytics',
      items: [
        { label: 'Feeding Mode Report', path: '/operator/feeding-mode', icon: TrendingUp, desc: 'System stabilization metrics' },
        { label: 'Fingerprints Explorer', path: '/operator/fingerprints', icon: Fingerprint, desc: 'Browse fingerprint outcomes' },
        { label: 'Benchmark Gaps', path: '/operator/benchmark-gaps', icon: Target, desc: 'Gaps needing sales data' },
        { label: 'Benchmark Watchlist', path: '/operator/benchmark-watchlist', icon: Target, desc: 'Thin & stale benchmarks' },
      ]
    },
    {
      title: 'Admin',
      items: [
        { label: 'Dealer Onboarding', path: '/operator/dealer-onboarding', icon: Users, desc: 'Add new dealers' },
        { label: 'Settings', path: '/operator/settings', icon: Settings, desc: 'System configuration' },
      ]
    }
  ];

  return (
    <OperatorLayout>
      <div className="p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operator Dashboard</h1>
          <p className="text-muted-foreground">Backend monitoring and controls</p>
        </div>

        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-lg font-semibold text-foreground mb-4">{section.title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {section.items.map((item) => (
                <Link key={item.path} to={item.path}>
                  <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <item.icon className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">{item.label}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{item.desc}</CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OperatorLayout>
  );
}
