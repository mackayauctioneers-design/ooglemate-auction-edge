import { useState, useEffect } from 'react';
import { Play, Loader2, CheckCircle, AlertCircle, Inbox } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { AccountSelector } from '@/components/carbitrage/AccountSelector';
import { useAccounts } from '@/hooks/useAccounts';

interface ReleaseResult {
  success: boolean;
  released?: number;
  currently_pending?: number;
  hold_remaining?: number;
  would_release?: number;
  message?: string;
  dry_run?: boolean;
}

export function ReleaseBatchCard() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);
  const [result, setResult] = useState<ReleaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAccountId) return;
    if (!accounts?.length) return;
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setSelectedAccountId(mackay?.id ?? accounts[0].id);
  }, [accounts, selectedAccountId]);

  const handleRelease = async (dryRun: boolean) => {
    if (!selectedAccountId) {
      setError('Please select an account');
      return;
    }

    setIsLoading(true);
    setIsDryRun(dryRun);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('release-pickles-batch', {
        body: { account_id: selectedAccountId, batch_size: 50, dry_run: dryRun }
      });

      if (fnError) throw new Error(fnError.message || 'Function call failed');
      if (data.error) throw new Error(data.error);

      setResult(data as ReleaseResult);

      if (!dryRun && data.released > 0) {
        toast({
          title: 'Batch released',
          description: `${data.released} items now pending in Josh Inbox`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({ title: 'Release failed', description: message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          Release Pickles Batch
        </CardTitle>
        <CardDescription>
          Promote the next 50 hold items to pending so Josh can triage them. Run daily after Josh clears the current batch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Account:</span>
          <AccountSelector value={selectedAccountId} onChange={setSelectedAccountId} />
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => handleRelease(true)} disabled={isLoading || !selectedAccountId}>
            {isLoading && isDryRun && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Check Status
          </Button>
          <Button onClick={() => handleRelease(false)} disabled={isLoading || !selectedAccountId}>
            {isLoading && !isDryRun && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Play className="h-4 w-4 mr-2" />
            Release 50
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
              <div className="space-y-1">
                {result.dry_run ? (
                  <>
                    <p className="font-medium">Current status</p>
                    <p className="text-sm text-muted-foreground">
                      On hold: {result.hold_remaining}
                      {' • '} Currently pending: {result.currently_pending}
                      {' • '} Would release: {result.would_release}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">{result.message}</p>
                    <p className="text-sm text-muted-foreground">
                      Released: {result.released}
                      {' • '} Now pending: {result.currently_pending}
                      {' • '} Still on hold: {result.hold_remaining}
                    </p>
                  </>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
