import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Car, Settings, MapPin, DollarSign, Tag, Loader2 } from "lucide-react";
import type { SaleHunt } from "@/types/hunts";

interface EditHuntDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hunt: SaleHunt;
}

export function EditHuntDrawer({ open, onOpenChange, hunt }: EditHuntDrawerProps) {
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    // Vehicle identity
    year: hunt.year,
    make: hunt.make,
    model: hunt.model,
    variant_family: hunt.variant_family || '',
    
    // LC79 Precision Pack
    engine_code: hunt.engine_code || '',
    cab_type: hunt.cab_type || '',
    series_family: hunt.series_family || '',
    
    // Drivetrain
    fuel: hunt.fuel || '',
    transmission: hunt.transmission || '',
    drivetrain: hunt.drivetrain || '',
    
    // KM targeting
    km: hunt.km || 0,
    km_tolerance_pct: hunt.km_tolerance_pct,
    
    // Pricing thresholds
    proven_exit_value: hunt.proven_exit_value || 0,
    min_gap_pct_buy: hunt.min_gap_pct_buy,
    min_gap_pct_watch: hunt.min_gap_pct_watch,
    min_gap_abs_buy: hunt.min_gap_abs_buy,
    min_gap_abs_watch: hunt.min_gap_abs_watch,
    
    // Freshness
    max_listing_age_days_buy: hunt.max_listing_age_days_buy,
    max_listing_age_days_watch: hunt.max_listing_age_days_watch,
    
    // Geo
    geo_mode: hunt.geo_mode,
    states: hunt.states || [],
    
    // Must-have keywords
    must_have_raw: hunt.must_have_raw || '',
    must_have_mode: hunt.must_have_mode || 'soft',
    
    // Notes
    notes: hunt.notes || '',
  });

  // Reset form when hunt changes
  useEffect(() => {
    setFormData({
      year: hunt.year,
      make: hunt.make,
      model: hunt.model,
      variant_family: hunt.variant_family || '',
      engine_code: hunt.engine_code || '',
      cab_type: hunt.cab_type || '',
      series_family: hunt.series_family || '',
      fuel: hunt.fuel || '',
      transmission: hunt.transmission || '',
      drivetrain: hunt.drivetrain || '',
      km: hunt.km || 0,
      km_tolerance_pct: hunt.km_tolerance_pct,
      proven_exit_value: hunt.proven_exit_value || 0,
      min_gap_pct_buy: hunt.min_gap_pct_buy,
      min_gap_pct_watch: hunt.min_gap_pct_watch,
      min_gap_abs_buy: hunt.min_gap_abs_buy,
      min_gap_abs_watch: hunt.min_gap_abs_watch,
      max_listing_age_days_buy: hunt.max_listing_age_days_buy,
      max_listing_age_days_watch: hunt.max_listing_age_days_watch,
      geo_mode: hunt.geo_mode,
      states: hunt.states || [],
      must_have_raw: hunt.must_have_raw || '',
      must_have_mode: hunt.must_have_mode || 'soft',
      notes: hunt.notes || '',
    });
  }, [hunt]);

  const updateField = <K extends keyof typeof formData>(key: K, value: typeof formData[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      // Normalize must_have_raw into tokens
      const mustHaveTokens = formData.must_have_raw
        .split(',')
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);

      const updates = {
        year: formData.year,
        make: formData.make.toUpperCase(),
        model: formData.model.toUpperCase(),
        variant_family: formData.variant_family || null,
        engine_code: formData.engine_code.toUpperCase() || null,
        cab_type: formData.cab_type.toUpperCase() || null,
        series_family: formData.series_family.toUpperCase() || null,
        fuel: formData.fuel || null,
        transmission: formData.transmission || null,
        drivetrain: formData.drivetrain || null,
        km: formData.km || null,
        km_tolerance_pct: formData.km_tolerance_pct,
        proven_exit_value: formData.proven_exit_value || null,
        min_gap_pct_buy: formData.min_gap_pct_buy,
        min_gap_pct_watch: formData.min_gap_pct_watch,
        min_gap_abs_buy: formData.min_gap_abs_buy,
        min_gap_abs_watch: formData.min_gap_abs_watch,
        max_listing_age_days_buy: formData.max_listing_age_days_buy,
        max_listing_age_days_watch: formData.max_listing_age_days_watch,
        geo_mode: formData.geo_mode,
        states: formData.states.length > 0 ? formData.states : null,
        must_have_raw: formData.must_have_raw || null,
        must_have_tokens: mustHaveTokens.length > 0 ? mustHaveTokens : null,
        must_have_mode: formData.must_have_mode,
        notes: formData.notes || null,
      };

      const { error } = await (supabase as any)
        .from('sale_hunts')
        .update(updates)
        .eq('id', hunt.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunt', hunt.id] });
      queryClient.invalidateQueries({ queryKey: ['hunts'] });
      toast.success('Hunt updated successfully');
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update hunt: ${error.message}`);
    }
  });

  const cabTypeOptions = ['SINGLE', 'DUAL', 'EXTRA', 'UNKNOWN'];
  const engineCodeOptions = ['1VD-FTV', '1GD-FTV', '2GD-FTV', '1GR-FE', '2TR-FE', 'UNKNOWN'];
  const fuelOptions = ['Diesel', 'Petrol', 'Hybrid', 'Electric'];
  const transmissionOptions = ['Manual', 'Automatic'];
  const drivetrainOptions = ['4WD', 'AWD', '2WD', 'FWD', 'RWD'];
  const stateOptions = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="border-b">
          <DrawerTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Edit Hunt: {hunt.year} {hunt.make} {hunt.model}
          </DrawerTitle>
        </DrawerHeader>
        
        <div className="overflow-y-auto p-4">
          <Tabs defaultValue="vehicle" className="w-full">
            <TabsList className="w-full grid grid-cols-4 mb-4">
              <TabsTrigger value="vehicle" className="text-xs">
                <Car className="h-3 w-3 mr-1" />
                Vehicle
              </TabsTrigger>
              <TabsTrigger value="pricing" className="text-xs">
                <DollarSign className="h-3 w-3 mr-1" />
                Pricing
              </TabsTrigger>
              <TabsTrigger value="geo" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />
                Geo
              </TabsTrigger>
              <TabsTrigger value="keywords" className="text-xs">
                <Tag className="h-3 w-3 mr-1" />
                Keywords
              </TabsTrigger>
            </TabsList>

            {/* Vehicle Identity Tab */}
            <TabsContent value="vehicle" className="space-y-4 mt-0">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="make">Make</Label>
                  <Input
                    id="make"
                    value={formData.make}
                    onChange={(e) => updateField('make', e.target.value)}
                    className="bg-input uppercase"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    className="bg-input uppercase"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="year">Year</Label>
                  <Input
                    id="year"
                    type="number"
                    min={2000}
                    max={2030}
                    value={formData.year}
                    onChange={(e) => updateField('year', parseInt(e.target.value) || 2020)}
                    className="bg-input mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="variant_family">Variant / Badge</Label>
                  <Input
                    id="variant_family"
                    value={formData.variant_family}
                    onChange={(e) => updateField('variant_family', e.target.value)}
                    placeholder="e.g. SR5, Wildtrak, GXL"
                    className="bg-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="series_family">Series Family</Label>
                  <Input
                    id="series_family"
                    value={formData.series_family}
                    onChange={(e) => updateField('series_family', e.target.value)}
                    placeholder="e.g. LC79, N80, GUN126"
                    className="bg-input uppercase"
                  />
                </div>
              </div>

              {/* LC79 Precision Pack */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-800">
                <div className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-3">
                  LC79 Precision Pack (for 70 Series)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="engine_code">Engine Code</Label>
                    <Select value={formData.engine_code} onValueChange={(v) => updateField('engine_code', v)}>
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select engine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Not specified</SelectItem>
                        {engineCodeOptions.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cab_type">Cab Type</Label>
                    <Select value={formData.cab_type} onValueChange={(v) => updateField('cab_type', v)}>
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select cab" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Not specified</SelectItem>
                        {cabTypeOptions.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Drivetrain */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fuel">Fuel</Label>
                  <Select value={formData.fuel} onValueChange={(v) => updateField('fuel', v)}>
                    <SelectTrigger className="bg-input">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      {fuelOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transmission">Transmission</Label>
                  <Select value={formData.transmission} onValueChange={(v) => updateField('transmission', v)}>
                    <SelectTrigger className="bg-input">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      {transmissionOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="drivetrain">Drivetrain</Label>
                  <Select value={formData.drivetrain} onValueChange={(v) => updateField('drivetrain', v)}>
                    <SelectTrigger className="bg-input">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      {drivetrainOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* KM Targeting */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="km">Target KM</Label>
                  <Input
                    id="km"
                    type="number"
                    min={0}
                    step={1000}
                    value={formData.km}
                    onChange={(e) => updateField('km', parseInt(e.target.value) || 0)}
                    placeholder="e.g. 85000"
                    className="bg-input mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="km_tolerance">KM Tolerance %</Label>
                  <Input
                    id="km_tolerance"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.km_tolerance_pct}
                    onChange={(e) => updateField('km_tolerance_pct', parseInt(e.target.value) || 25)}
                    className="bg-input mono"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Pricing Tab */}
            <TabsContent value="pricing" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="proven_exit">Proven Exit Value ($)</Label>
                <Input
                  id="proven_exit"
                  type="number"
                  min={0}
                  step={1000}
                  value={formData.proven_exit_value}
                  onChange={(e) => updateField('proven_exit_value', parseInt(e.target.value) || 0)}
                  className="bg-input mono"
                />
                <p className="text-xs text-muted-foreground">
                  Your actual sale price. Used to calculate price gap.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800">
                <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-3">
                  BUY Thresholds (Strike opportunity)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="min_gap_pct_buy">Min Gap % for BUY</Label>
                    <Input
                      id="min_gap_pct_buy"
                      type="number"
                      min={0}
                      max={50}
                      value={formData.min_gap_pct_buy}
                      onChange={(e) => updateField('min_gap_pct_buy', parseFloat(e.target.value) || 8)}
                      className="bg-input mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="min_gap_abs_buy">Min Gap $ for BUY</Label>
                    <Input
                      id="min_gap_abs_buy"
                      type="number"
                      min={0}
                      step={500}
                      value={formData.min_gap_abs_buy}
                      onChange={(e) => updateField('min_gap_abs_buy', parseInt(e.target.value) || 3000)}
                      className="bg-input mono"
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-800">
                <div className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-3">
                  WATCH Thresholds (Worth monitoring)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="min_gap_pct_watch">Min Gap % for WATCH</Label>
                    <Input
                      id="min_gap_pct_watch"
                      type="number"
                      min={0}
                      max={50}
                      value={formData.min_gap_pct_watch}
                      onChange={(e) => updateField('min_gap_pct_watch', parseFloat(e.target.value) || 3)}
                      className="bg-input mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="min_gap_abs_watch">Min Gap $ for WATCH</Label>
                    <Input
                      id="min_gap_abs_watch"
                      type="number"
                      min={0}
                      step={500}
                      value={formData.min_gap_abs_watch}
                      onChange={(e) => updateField('min_gap_abs_watch', parseInt(e.target.value) || 1500)}
                      className="bg-input mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max_age_buy">Max Listing Age (BUY)</Label>
                  <Input
                    id="max_age_buy"
                    type="number"
                    min={1}
                    max={90}
                    value={formData.max_listing_age_days_buy}
                    onChange={(e) => updateField('max_listing_age_days_buy', parseInt(e.target.value) || 7)}
                    className="bg-input mono"
                  />
                  <p className="text-xs text-muted-foreground">Days</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_age_watch">Max Listing Age (WATCH)</Label>
                  <Input
                    id="max_age_watch"
                    type="number"
                    min={1}
                    max={180}
                    value={formData.max_listing_age_days_watch}
                    onChange={(e) => updateField('max_listing_age_days_watch', parseInt(e.target.value) || 30)}
                    className="bg-input mono"
                  />
                  <p className="text-xs text-muted-foreground">Days</p>
                </div>
              </div>
            </TabsContent>

            {/* Geo Tab */}
            <TabsContent value="geo" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label>Geo Mode</Label>
                <Select value={formData.geo_mode} onValueChange={(v) => updateField('geo_mode', v)}>
                  <SelectTrigger className="bg-input">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national">National (all states)</SelectItem>
                    <SelectItem value="state_filter">Filter by state</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.geo_mode === 'state_filter' && (
                <div className="space-y-2">
                  <Label>States</Label>
                  <div className="flex flex-wrap gap-2">
                    {stateOptions.map(state => {
                      const isSelected = formData.states.includes(state);
                      return (
                        <Button
                          key={state}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            if (isSelected) {
                              updateField('states', formData.states.filter(s => s !== state));
                            } else {
                              updateField('states', [...formData.states, state]);
                            }
                          }}
                        >
                          {state}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Keywords Tab */}
            <TabsContent value="keywords" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="must_have_raw">Must-Have Keywords</Label>
                <Textarea
                  id="must_have_raw"
                  value={formData.must_have_raw}
                  onChange={(e) => updateField('must_have_raw', e.target.value)}
                  placeholder="e.g. Norweld tray, snorkel, sunroof"
                  className="bg-input"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated keywords that must appear in listing text
                </p>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <Label htmlFor="strict_mode">Strict Mode</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Reject listings that don't contain keywords
                  </p>
                </div>
                <Switch
                  id="strict_mode"
                  checked={formData.must_have_mode === 'strict'}
                  onCheckedChange={(checked) => updateField('must_have_mode', checked ? 'strict' : 'soft')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="Internal notes about this hunt..."
                  className="bg-input"
                  rows={3}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DrawerFooter className="border-t">
          <div className="flex justify-end gap-2">
            <DrawerClose asChild>
              <Button variant="outline">Cancel</Button>
            </DrawerClose>
            <Button 
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
