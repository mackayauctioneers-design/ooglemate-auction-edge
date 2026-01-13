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
  { value: 'ramp', label: 'RAMP' },
];

const TRAP_MODES = [
  { value: 'auto', label: 'Auto (site crawl)' },
  { value: 'portal', label: 'Portal-backed (OEM feed)' },
  { value: 'va', label: 'VA-fed (manual)' },
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
  const [parserMode, setParserMode] = useState<'adtorque' | 'digitaldealer' | 'ramp'>('digitaldealer');
  const [trapMode, setTrapMode] = useState<'auto' | 'portal' | 'va'>('auto');
  const [isAnchor, setIsAnchor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentAdds, setRecentAdds] = useState<string[]>([]);

  // Auto-detect parser mode and trap mode when URL/dealer name changes
  const handleUrlChange = (url: string) => {
    setInventoryUrl(url);
    if (url.length > 10) {
      setParserMode(guessParserMode(url));
    }
  };

  // Auto-suggest portal mode for franchise dealers
  const handleDealerNameChange = (name: string) => {
    setDealerName(name);
    const lowerName = name.toLowerCase();
    if (lowerName.includes('toyota') || lowerName.includes('mazda') || 
        lowerName.includes('hyundai') || lowerName.includes('kia')) {
      setTrapMode('portal');
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
        trap_mode: trapMode,
        anchor_trap: isAnchor,
        enabled: trapMode === 'portal' || trapMode === 'va' ? false : false, // Portal/VA don't need crawl enabled
        validation_status: trapMode === 'portal' || trapMode === 'va' ? 'not_required' : 'pending',
        preflight_status: trapMode === 'portal' || trapMode === 'va' ? 'not_required' : 'pending',
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
              onChange={(e) => handleDealerNameChange(e.target.value)}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="trapMode">Operating Mode *</Label>
            <Select value={trapMode} onValueChange={(v) => setTrapMode(v as 'auto' | 'portal' | 'va')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAP_MODES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {trapMode === 'portal' && 'Uses OEM portal feed (no site crawl needed)'}
              {trapMode === 'va' && 'VA manually submits inventory updates'}
              {trapMode === 'auto' && 'System crawls dealer site automatically'}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parserMode">Parser Mode</Label>
            <Select 
              value={parserMode} 
              onValueChange={(v) => setParserMode(v as 'adtorque' | 'digitaldealer' | 'ramp')}
              disabled={trapMode !== 'auto'}
            >
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
              {trapMode === 'auto' ? 'Auto-detected from URL.' : 'N/A for this mode'}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Anchor Trap</Label>
            <div className="flex items-center gap-3 pt-2">
              <Switch checked={isAnchor} onCheckedChange={setIsAnchor} />
              <span className="text-sm text-muted-foreground">
                {isAnchor ? 'Yes (high priority)' : 'No'}
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
