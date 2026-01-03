import { useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { NetworkValuationCard } from '@/components/valuation/NetworkValuationCard';
import { ManualFingerprintForm } from '@/components/fingerprints/ManualFingerprintForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Fingerprint } from 'lucide-react';

export default function ValuationPage() {
  useEffect(() => {
    document.title = 'Valuation | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Valuation</h1>
            <p className="text-muted-foreground">
              Get market insights based on network sales data
            </p>
          </div>
          <ManualFingerprintForm />
        </div>

        {/* Network Proxy Valuation */}
        <NetworkValuationCard />

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Fingerprint className="h-5 w-5" />
              About Network Valuation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>
              <strong className="text-foreground">How it works:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Searches anonymised sales data across the network</li>
                <li>Matches by make, model, variant family, and year (±2)</li>
                <li>Aggregates buy/sell prices, gross profit, and days to sell</li>
              </ul>
            </div>
            
            <div>
              <strong className="text-foreground">Confidence Levels:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li><span className="text-green-600 font-medium">HIGH</span> — Based on your own internal sales (3+ records)</li>
                <li><span className="text-yellow-600 font-medium">MEDIUM</span> — Based on anonymised network data (3+ records)</li>
                <li><span className="text-red-600 font-medium">LOW</span> — Insufficient data (less than 3 comparable sales)</li>
              </ul>
            </div>

            <div>
              <strong className="text-foreground">Privacy:</strong>
              <p className="mt-1">
                Dealer identities, locations, and raw transaction details are never exposed.
                Only aggregated metrics are shown.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
