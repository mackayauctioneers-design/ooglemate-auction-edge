import { useState, useRef } from 'react';
import { Upload, Loader2, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { AccountSelector } from '@/components/carbitrage/AccountSelector';
import { useAccounts } from '@/hooks/useAccounts';
import { useEffect } from 'react';

interface SeedResult {
  success: boolean;
  rows_parsed: number;
  inserted: number;
  pending_count: number;
  hold_count: number;
  errors: number;
  message: string;
  dry_run?: boolean;
  sample?: Array<{
    url_canonical: string;
    status: string;
    result_summary: {
      make: string;
      model: string;
      year: number;
      lotId: string;
    };
  }>;
}

export function PicklesCsvSeeder() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedAccountId) return;
    if (!accounts?.length) return;
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setSelectedAccountId(mackay?.id ?? accounts[0].id);
  }, [accounts, selectedAccountId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
  };

  const handleSeed = async (dryRun: boolean) => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Please select a CSV file first');
      return;
    }
    if (!selectedAccountId) {
      setError('Please select an account');
      return;
    }

    setIsLoading(true);
    setIsDryRun(dryRun);
    setError(null);
    setResult(null);

    try {
      const csvContent = await file.text();

      const { data, error: fnError } = await supabase.functions.invoke('seed-pickles-queue', {
        body: { csv_content: csvContent, dry_run: dryRun, account_id: selectedAccountId }
      });

      if (fnError) throw new Error(fnError.message || 'Function call failed');
      if (data.error) throw new Error(data.error);

      setResult(data as SeedResult);

      if (!dryRun) {
        toast({
          title: 'Seed complete',
          description: `${data.pending_count} pending, ${data.hold_count} on hold in Josh Inbox`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({ title: 'Seed failed', description: message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Pickles CSV → Josh Inbox
        </CardTitle>
        <CardDescription>
          Seed Pickles auction listings into the dealer URL queue for Josh to triage. First 50 go pending, rest on hold.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Account Selector */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Account:</span>
          <AccountSelector value={selectedAccountId} onChange={setSelectedAccountId} />
        </div>

        {/* File Input */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            id="pickles-csv-input"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
            <FileText className="h-4 w-4 mr-2" />
            Select CSV
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => handleSeed(true)} disabled={isLoading || !fileName || !selectedAccountId}>
            {isLoading && isDryRun && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Dry Run
          </Button>
          <Button onClick={() => handleSeed(false)} disabled={isLoading || !fileName || !selectedAccountId}>
            {isLoading && !isDryRun && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Seed Queue
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert className={result.dry_run ? "border-amber-500" : "border-emerald-600"}>
            <CheckCircle className={`h-4 w-4 ${result.dry_run ? "text-amber-500" : "text-emerald-600"}`} />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">{result.message}</p>
                <p className="text-sm text-muted-foreground">
                  Parsed: {result.rows_parsed} rows
                  {' • '} Pending: {result.pending_count}
                  {' • '} On hold: {result.hold_count}
                  {!result.dry_run && ` • Errors: ${result.errors}`}
                </p>
                {result.sample && result.sample.length > 0 && (
                  <div className="text-xs mt-2 space-y-1">
                    <p className="font-medium">Sample:</p>
                    {result.sample.map((item, i) => (
                      <div key={i} className="text-muted-foreground">
                        [{item.status}] {item.result_summary?.year} {item.result_summary?.make} {item.result_summary?.model} — {item.url_canonical?.slice(0, 60)}…
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
