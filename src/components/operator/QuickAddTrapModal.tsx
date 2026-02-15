import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Plus, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

interface QuickAddTrapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function guessParser(url: string): 'adtorque' | 'digitaldealer' {
  const lower = url.toLowerCase();
  if (lower.includes('/stock') || lower.includes('adtorqueedge')) return 'adtorque';
  return 'digitaldealer';
}

type SubmitState = 'idle' | 'inserting' | 'validating' | 'success' | 'error';

export function QuickAddTrapModal({ open, onOpenChange, onAdded }: QuickAddTrapModalProps) {
  const [dealerName, setDealerName] = useState('');
  const [url, setUrl] = useState('');
  const [frequency, setFrequency] = useState('every_2h');
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => {
    setDealerName('');
    setUrl('');
    setFrequency('every_2h');
    setEnabled(true);
    setNotes('');
    setState('idle');
    setVehicleCount(null);
    setErrorMsg('');
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    if (!dealerName.trim()) {
      toast.error('Dealer name is required');
      return;
    }
    try {
      new URL(url);
    } catch {
      toast.error('Enter a valid URL (e.g. https://dealer.com.au/used-cars)');
      return;
    }

    const slug = generateSlug(dealerName);
    const parser = guessParser(url);

    // Step 1: Insert
    setState('inserting');
    try {
      const { error } = await supabase.from('dealer_traps').insert({
        trap_slug: slug,
        dealer_name: dealerName.trim(),
        inventory_url: url.trim(),
        region_id: 'NSW_SYDNEY_METRO',
        parser_mode: parser,
        trap_mode: 'auto',
        anchor_trap: false,
        enabled: false, // enable after validation
        validation_status: 'pending',
        preflight_status: 'pending',
        priority: 'normal',
      });

      if (error) {
        if (error.code === '23505') {
          toast.error('A trap with this name/slug already exists');
        } else {
          throw error;
        }
        setState('idle');
        return;
      }
    } catch (err) {
      console.error('Insert failed:', err);
      setState('error');
      setErrorMsg('Failed to save trap to database');
      return;
    }

    // Step 2: Validate with a test crawl
    setState('validating');
    try {
      const res = await supabase.functions.invoke('dealer-site-crawl', {
        body: { trap_slug: slug, dry_run: true },
      });

      if (res.error) throw res.error;

      const data = res.data as { vehicles_found?: number; status?: string; error?: string };
      const count = data?.vehicles_found ?? 0;

      if (count > 0) {
        // Enable the trap since validation passed
        await supabase.from('dealer_traps').update({
          enabled: enabled,
          validation_status: 'validated',
          preflight_status: 'pass',
          last_vehicle_count: count,
        }).eq('trap_slug', slug);

        setVehicleCount(count);
        setState('success');
        toast.success(`Trap added! Found ${count} vehicles on first crawl.`);
        onAdded();
      } else {
        setVehicleCount(0);
        setState('error');
        setErrorMsg(data?.error || 'No vehicles found — check the URL points to a used car listing page.');
      }
    } catch (err) {
      console.error('Validation crawl failed:', err);
      setState('error');
      setErrorMsg('Validation crawl failed — site may be down or blocking crawlers.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add New Competitor Trap
          </DialogTitle>
          <DialogDescription>
            Enter a used cars listing page URL — we'll crawl it automatically for vehicle data.
          </DialogDescription>
        </DialogHeader>

        {state === 'success' ? (
          <div className="py-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <div>
              <p className="text-lg font-semibold">Trap Added & Validated!</p>
              <p className="text-muted-foreground">
                Found <span className="font-mono font-bold text-foreground">{vehicleCount}</span> vehicles on first crawl.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
              <Button onClick={() => { reset(); }}>
                Add Another
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="q-dealer">Dealer Name *</Label>
                <Input
                  id="q-dealer"
                  placeholder="Brian Hilton Toyota"
                  value={dealerName}
                  onChange={(e) => setDealerName(e.target.value)}
                  disabled={state !== 'idle' && state !== 'error'}
                />
                {dealerName && (
                  <p className="text-xs text-muted-foreground">
                    Slug: <code className="bg-muted px-1 rounded">{generateSlug(dealerName)}</code>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="q-url">Trap URL *</Label>
                <Input
                  id="q-url"
                  type="url"
                  placeholder="https://www.brianhiltontoyota.com.au/used-cars"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={state !== 'idle' && state !== 'error'}
                />
                <p className="text-xs text-muted-foreground">
                  Must be the page showing multiple vehicle cards (not a single vehicle page).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency} disabled={state !== 'idle' && state !== 'error'}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="every_2h">Every 2 hours</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Auto-Enable</Label>
                  <div className="flex items-center gap-3 pt-2">
                    <Switch checked={enabled} onCheckedChange={setEnabled} disabled={state !== 'idle' && state !== 'error'} />
                    <span className="text-sm text-muted-foreground">{enabled ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="q-notes">Notes (optional)</Label>
                <Textarea
                  id="q-notes"
                  placeholder="Toyota dealer site for Ranger/HiLux arbitrage"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  disabled={state !== 'idle' && state !== 'error'}
                />
              </div>

              {state === 'error' && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <span className="text-destructive">{errorMsg}</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={state === 'inserting' || state === 'validating'}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={state === 'inserting' || state === 'validating'}>
                {state === 'inserting' ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                ) : state === 'validating' ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Validating crawl...</>
                ) : state === 'error' ? (
                  'Retry'
                ) : (
                  <><Plus className="h-4 w-4 mr-2" /> Add & Validate</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
