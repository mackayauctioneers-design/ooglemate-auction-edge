import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Loader2, CheckCircle2 } from 'lucide-react';

const REGIONS = [
  { value: 'NSW_SYDNEY_METRO', label: 'NSW Sydney Metro' },
  { value: 'NSW_HUNTER_NEWCASTLE', label: 'NSW Hunter / Newcastle' },
  { value: 'NSW_CENTRAL_COAST', label: 'NSW Central Coast' },
  { value: 'NSW_REGIONAL', label: 'NSW Regional' },
];

const PARSER_MODES = [
  { value: 'adtorque', label: 'AdTorque' },
  { value: 'digitaldealer', label: 'DigitalDealer' },
];

// Auto-detect parser mode from URL patterns
function guessParserMode(url: string): 'adtorque' | 'digitaldealer' {
  const lowerUrl = url.toLowerCase();
  // AdTorque patterns
  if (lowerUrl.includes('/stock') || lowerUrl.includes('adtorqueedge')) {
    return 'adtorque';
  }
  // DigitalDealer patterns
  if (lowerUrl.includes('/used-cars') || lowerUrl.includes('/our-stock') || lowerUrl.includes('/pre-owned')) {
    return 'digitaldealer';
  }
  // Default to digitaldealer as it's more common
  return 'digitaldealer';
}

// Generate trap_slug from dealer name
function generateTrapSlug(dealerName: string): string {
  return dealerName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

interface TrapCandidateIntakeProps {
  onAdded?: () => void;
}

export function TrapCandidateIntake({ onAdded }: TrapCandidateIntakeProps) {
  const [dealerName, setDealerName] = useState('');
  const [inventoryUrl, setInventoryUrl] = useState('');
  const [regionId, setRegionId] = useState('');
  const [parserMode, setParserMode] = useState<'adtorque' | 'digitaldealer'>('digitaldealer');
  const [isAnchor, setIsAnchor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentAdds, setRecentAdds] = useState<string[]>([]);

  // Auto-detect parser mode when URL changes
  const handleUrlChange = (url: string) => {
    setInventoryUrl(url);
    if (url.length > 10) {
      setParserMode(guessParserMode(url));
    }
  };

  const handleSubmit = async () => {
    if (!dealerName.trim() || !inventoryUrl.trim() || !regionId) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Validate URL format
    try {
      new URL(inventoryUrl);
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    setLoading(true);
    const trapSlug = generateTrapSlug(dealerName);

    try {
      const { error } = await supabase.from('dealer_traps').insert({
        trap_slug: trapSlug,
        dealer_name: dealerName.trim(),
        inventory_url: inventoryUrl.trim(),
        region_id: regionId,
        parser_mode: parserMode,
        anchor_trap: isAnchor,
        enabled: false,
        validation_status: 'pending',
        preflight_status: 'pending',
        priority: isAnchor ? 'high' : 'normal',
      });

      if (error) {
        if (error.code === '23505') {
          toast.error('A trap with this slug already exists');
        } else {
          throw error;
        }
        return;
      }

      toast.success(`Added: ${dealerName}`);
      setRecentAdds(prev => [trapSlug, ...prev.slice(0, 4)]);
      
      // Reset form
      setDealerName('');
      setInventoryUrl('');
      setIsAnchor(false);
      // Keep region for batch adding
      
      onAdded?.();
    } catch (err) {
      console.error('Failed to add trap candidate:', err);
      toast.error('Failed to add trap candidate');
    } finally {
      setLoading(false);
    }
  };

  const runPreflight = async () => {
    try {
      toast.info('Running preflight on pending traps...');
      const res = await supabase.functions.invoke('trap-preflight', {
        body: { check_all_pending: true, limit: 10 },
      });
      
      if (res.error) throw res.error;
      
      const data = res.data as { results?: Array<{ trap_slug: string; status: string }> };
      const passed = data?.results?.filter((r) => r.status === 'pass').length ?? 0;
      const failed = data?.results?.filter((r) => r.status !== 'pass').length ?? 0;
      
      toast.success(`Preflight complete: ${passed} passed, ${failed} failed`);
      onAdded?.();
    } catch (err) {
      console.error('Preflight failed:', err);
      toast.error('Preflight failed');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Trap Candidate
        </CardTitle>
        <CardDescription>
          Add franchise dealer sites for preflight → validation → auto-enable
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="dealerName">Dealer Name *</Label>
            <Input
              id="dealerName"
              placeholder="e.g. Newcastle Toyota"
              value={dealerName}
              onChange={(e) => setDealerName(e.target.value)}
            />
            {dealerName && (
              <div className="text-xs text-muted-foreground">
                Slug: <code className="bg-muted px-1 rounded">{generateTrapSlug(dealerName)}</code>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="regionId">Region *</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="inventoryUrl">Inventory URL *</Label>
          <Input
            id="inventoryUrl"
            placeholder="https://dealer.com.au/stock/used-cars"
            value={inventoryUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            Must be the page showing multiple vehicle cards (not a single vehicle page)
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="parserMode">Parser Mode</Label>
            <Select value={parserMode} onValueChange={(v) => setParserMode(v as 'adtorque' | 'digitaldealer')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARSER_MODES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Auto-detected from URL. Override if needed.
            </div>
          </div>

          <div className="space-y-2">
            <Label>Anchor Trap</Label>
            <div className="flex items-center gap-3 pt-2">
              <Switch checked={isAnchor} onCheckedChange={setIsAnchor} />
              <span className="text-sm text-muted-foreground">
                {isAnchor ? 'Yes (high priority, alert on failures)' : 'No'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add Candidate
              </>
            )}
          </Button>

          <Button variant="outline" onClick={runPreflight}>
            Run Preflight (pending)
          </Button>
        </div>

        {recentAdds.length > 0 && (
          <div className="pt-4 border-t">
            <div className="text-sm font-medium mb-2">Recently Added</div>
            <div className="flex flex-wrap gap-2">
              {recentAdds.map((slug) => (
                <Badge key={slug} variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {slug}
                </Badge>
              ))
              }
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
