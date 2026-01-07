import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Fingerprint } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { extractVariantFamily } from '@/types';

interface ManualFingerprintFormProps {
  onSuccess?: () => void;
}

export function ManualFingerprintForm({ onSuccess }: ManualFingerprintFormProps) {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [specOnlyMode, setSpecOnlyMode] = useState(false);
  const [saleKm, setSaleKm] = useState('');
  const [engine, setEngine] = useState('');
  const [drivetrain, setDrivetrain] = useState('');
  const [transmission, setTransmission] = useState('');

  const handleSubmit = async () => {
    if (!make || !model || !yearFrom) {
      toast.error('Make, Model, and Year From are required');
      return;
    }

    if (!currentUser) {
      toast.error('You must be logged in');
      return;
    }

    setLoading(true);
    try {
      const yearFromNum = parseInt(yearFrom);
      const yearToNum = yearTo ? parseInt(yearTo) : yearFromNum;
      
      // Create fingerprints for each year in range
      const createdCount = await createFingerprintsForYearRange(
        yearFromNum,
        yearToNum
      );
      
      toast.success(`Created ${createdCount} manual fingerprint(s)`);
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error creating manual fingerprint:', error);
      toast.error('Failed to create fingerprint');
    } finally {
      setLoading(false);
    }
  };

  const createFingerprintsForYearRange = async (
    yearFrom: number,
    yearTo: number
  ): Promise<number> => {
    let count = 0;
    
    for (let year = yearFrom; year <= yearTo; year++) {
      const variantFamily = extractVariantFamily(variant);
      
      const km = specOnlyMode ? 0 : (saleKm ? parseInt(saleKm) : 0);
      const fingerprintType = specOnlyMode || !km ? 'spec_only' : 'full';
      
      await dataService.addFingerprint({
        dealer_name: currentUser!.dealer_name,
        dealer_whatsapp: '',
        sale_date: new Date().toISOString().split('T')[0],
        make,
        model,
        variant_normalised: variant,
        variant_family: variantFamily,
        year,
        sale_km: km,
        engine: engine || '',
        drivetrain: drivetrain || '',
        transmission: transmission || '',
        shared_opt_in: 'Y',
        fingerprint_type: fingerprintType,
        // Mark as manual - excluded from profit analytics
        is_manual: 'Y',
      } as any);
      
      count++;
    }
    
    return count;
  };

  const resetForm = () => {
    setMake('');
    setModel('');
    setVariant('');
    setYearFrom('');
    setYearTo('');
    setSpecOnlyMode(false);
    setSaleKm('');
    setEngine('');
    setDrivetrain('');
    setTransmission('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Manual Fingerprint
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            Create Manual Fingerprint
          </DialogTitle>
          <DialogDescription>
            Add a fingerprint for testing, prospecting, or advisory purposes.
            Manual fingerprints are excluded from profit analytics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Make & Model */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make *</Label>
              <Input
                id="make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="e.g., Toyota"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model *</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g., Hilux"
              />
            </div>
          </div>

          {/* Variant */}
          <div className="space-y-2">
            <Label htmlFor="variant">Variant</Label>
            <Input
              id="variant"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="e.g., SR5 Double Cab"
            />
          </div>

          {/* Year Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="yearFrom">Year From *</Label>
              <Input
                id="yearFrom"
                type="number"
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value)}
                placeholder="2020"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="yearTo">Year To</Label>
              <Input
                id="yearTo"
                type="number"
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value)}
                placeholder="2023 (optional)"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for single year
              </p>
            </div>
          </div>

          {/* Spec-Only Mode Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Spec-Only Mode</Label>
              <p className="text-xs text-muted-foreground">
                Ignore KM matching (Tier-2 matches only)
              </p>
            </div>
            <Switch
              checked={specOnlyMode}
              onCheckedChange={setSpecOnlyMode}
            />
          </div>

          {/* KM (if not spec-only) */}
          {!specOnlyMode && (
            <div className="space-y-2">
              <Label htmlFor="saleKm">KM Reference</Label>
              <Input
                id="saleKm"
                type="number"
                value={saleKm}
                onChange={(e) => setSaleKm(e.target.value)}
                placeholder="e.g., 80000"
              />
              <p className="text-xs text-muted-foreground">
                Matches lots within ±15,000 KM
              </p>
            </div>
          )}

          {/* Optional Specs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="engine">Engine</Label>
              <Select value={engine} onValueChange={setEngine}>
                <SelectTrigger id="engine">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="Diesel">Diesel</SelectItem>
                  <SelectItem value="Petrol">Petrol</SelectItem>
                  <SelectItem value="Hybrid">Hybrid</SelectItem>
                  <SelectItem value="Electric">Electric</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drivetrain">Drivetrain</Label>
              <Select value={drivetrain} onValueChange={setDrivetrain}>
                <SelectTrigger id="drivetrain">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="4x4">4x4</SelectItem>
                  <SelectItem value="4x2">4x2</SelectItem>
                  <SelectItem value="AWD">AWD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">Trans</Label>
              <Select value={transmission} onValueChange={setTransmission}>
                <SelectTrigger id="transmission">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="Automatic">Auto</SelectItem>
                  <SelectItem value="Manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !make || !model || !yearFrom}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Fingerprint'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
