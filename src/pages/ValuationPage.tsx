import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { NetworkValuationCard } from '@/components/valuation/NetworkValuationCard';
import { ManualFingerprintForm } from '@/components/fingerprints/ManualFingerprintForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Fingerprint } from 'lucide-react';
import { KitingWingMarkVideo } from '@/components/kiting';
import { SnapIdCapture, VehicleIntelligenceCard } from '@/components/snap-id';

interface SnapIdResult {
  sessionId: string;
  make: string | null;
  model: string | null;
  yearMin: number | null;
  yearMax: number | null;
  variant: string | null;
  transmission: string | null;
  fuelType: string | null;
  bodyType: string | null;
  confidence: "high" | "medium" | "low";
  knownIssues: string[];
  avoidedIssues: string[];
  whyThisMatters: string;
  vin: string | null;
}

export default function ValuationPage() {
  const [snapIdResult, setSnapIdResult] = useState<SnapIdResult | null>(null);

  useEffect(() => {
    document.title = 'Valuation | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  const handleSnapIdResult = (result: SnapIdResult) => {
    setSnapIdResult(result);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KitingWingMarkVideo size={48} />
            <div>
              <h1 className="text-3xl font-bold">Valuation</h1>
              <p className="text-muted-foreground">
                Get market insights based on network sales data
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SnapIdCapture onResult={handleSnapIdResult} />
            <ManualFingerprintForm />
          </div>
        </div>

        {/* Snap-ID Result */}
        {snapIdResult && (
          <VehicleIntelligenceCard
            make={snapIdResult.make}
            model={snapIdResult.model}
            yearMin={snapIdResult.yearMin}
            yearMax={snapIdResult.yearMax}
            variant={snapIdResult.variant}
            transmission={snapIdResult.transmission}
            fuelType={snapIdResult.fuelType}
            bodyType={snapIdResult.bodyType}
            confidence={snapIdResult.confidence}
            knownIssues={snapIdResult.knownIssues}
            avoidedIssues={snapIdResult.avoidedIssues}
            whyThisMatters={snapIdResult.whyThisMatters}
            vin={snapIdResult.vin}
            className="border-primary"
          />
        )}

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
                <li><span className="text-status-passed font-medium">HIGH</span> — Based on your own internal sales (3+ records)</li>
                <li><span className="text-action-watch font-medium">MEDIUM</span> — Based on anonymised network data (3+ records)</li>
                <li><span className="text-destructive font-medium">LOW</span> — Insufficient data (less than 3 comparable sales)</li>
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

      {/* Mobile FAB for Snap-ID */}
      <SnapIdCapture variant="fab" onResult={handleSnapIdResult} />
    </AppLayout>
  );
}
