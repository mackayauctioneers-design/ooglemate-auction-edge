import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dataService } from '@/services/dataService';
import { supabase } from '@/integrations/supabase/client';
import { Dealer, SaleLog } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { FileText, Save, Calendar, Car, Upload, Clock, DollarSign, Target, AlertTriangle, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { SalesCsvImport } from '@/components/sales/SalesCsvImport';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { DealerLinkPrompt } from '@/components/dealer/DealerLinkPrompt';
import { KitingIndicator, KitingWingMarkVideo } from '@/components/kiting';

export default function LogSalePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { dealerProfile, user } = useAuth();
  
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [recentSales, setRecentSales] = useState<SaleLog[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [salesDealerFilter, setSalesDealerFilter] = useState<string>('all');
  const [failedHuntSaleId, setFailedHuntSaleId] = useState<string | null>(null);
  const [isArmingHunt, setIsArmingHunt] = useState(false);
  const [kitingEngaged, setKitingEngaged] = useState(false);
  
  // Check if user has a linked dealer profile
  const isDealerLinked = !!dealerProfile?.dealer_profile_id;
  
  const [formData, setFormData] = useState({
    dealer_name: '',
    sale_date: format(new Date(), 'yyyy-MM-dd'),
    make: '',
    model: '',
    variant_normalised: '',
    year: new Date().getFullYear(),
    sale_km: 0,
    engine: '',
    drivetrain: '',
    transmission: '',
    shared_opt_in: false,
    buy_price: '',
    sell_price: '',
    // Trim/Badge for precision matching
    badge: '',
    // Universal body type for all vehicles
    body_type: '',
    // LC79 Precision Pack fields
    engine_code: '',
    cab_type: '',
    // Must-have keywords for picky buyers
    must_have_raw: '',
    must_have_mode: 'soft' as 'soft' | 'strict',
  });

  // Common badge patterns to auto-extract from variant/description
  const BADGE_PATTERNS = [
    'PREMIUM', 'ELITE', 'N LINE', 'N-LINE', 'ST-LINE', 'ST LINE',
    'GXL', 'VX', 'SAHARA', 'WORKMATE', 'GX',
    'SR5', 'SR', 'ROGUE', 'RUGGED', 'RUGGED X',
    'WILDTRAK', 'XLT', 'XL', 'XLS', 'XLT+',
    'GR', 'TRD', 'GT', 'RS', 'R-SPEC', 'R SPEC',
    'SPORT', 'LUXURY', 'TITANIUM', 'TREND', 'AMBIENTE',
    'ACTIVE', 'HIGHLANDER', 'KAKADU', 'PRADO',
  ];

  // Auto-extract badge from variant text
  const extractBadgeFromText = (text: string): string | null => {
    const upper = text.toUpperCase();
    for (const pattern of BADGE_PATTERNS) {
      if (upper.includes(pattern)) {
        return pattern.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    return null;
  };

  // Auto-populate badge when variant changes (if badge is empty)
  useEffect(() => {
    if (!formData.badge && formData.variant_normalised) {
      const extracted = extractBadgeFromText(formData.variant_normalised);
      if (extracted) {
        setFormData(prev => ({ ...prev, badge: extracted }));
      }
    }
  }, [formData.variant_normalised]);

  // Detect if current vehicle is variant-critical (engine/cab matters for matching)
  const makeUpper = formData.make.toUpperCase();
  const modelUpper = formData.model.toUpperCase();
  const variantUpper = formData.variant_normalised.toUpperCase();
  
  // LandCruiser 70/79/78/76 Series
  const isLC79Series = 
    makeUpper === 'TOYOTA' && 
    (modelUpper.includes('LANDCRUISER') || modelUpper.includes('LAND CRUISER')) &&
    (variantUpper.includes('79') || variantUpper.includes('78') || 
     variantUpper.includes('76') || variantUpper.includes('70') ||
     modelUpper.includes('79') || modelUpper.includes('78') || modelUpper.includes('76'));
  
  // Nissan Patrol Y61/GU
  const isPatrolY61 = 
    makeUpper === 'NISSAN' && 
    modelUpper.includes('PATROL') &&
    (variantUpper.includes('4.2') || variantUpper.includes('Y61') || 
     variantUpper.includes('GU') || variantUpper.includes('DX') ||
     variantUpper.includes('ST') || variantUpper.includes('TI'));
  
  // Combined flag for showing variant-critical fields
  const isVariantCritical = isLC79Series || isPatrolY61;

  const loadData = async () => {
    const [dealerList, sales] = await Promise.all([
      dataService.getDealers(),
      dataService.getSalesLog(50),
    ]);
    setDealers(dealerList.filter(d => d.enabled === 'Y'));
    setRecentSales(sales);
    setLoadingSales(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Pre-fill dealer name from linked profile
  useEffect(() => {
    if (dealerProfile?.dealer_name && !formData.dealer_name) {
      setFormData(prev => ({ ...prev, dealer_name: dealerProfile.dealer_name }));
    }
  }, [dealerProfile?.dealer_name]);

  // Prefill form from URL params (from Benchmark Gaps panel)
  useEffect(() => {
    const make = searchParams.get('make');
    const model = searchParams.get('model');
    const variant = searchParams.get('variant');
    const year = searchParams.get('year');

    const hasPrefill = make || model || variant || year;
    if (!hasPrefill) return;

    setFormData(prev => ({
      ...prev,
      make: make || prev.make,
      model: model || prev.model,
      variant_normalised: variant || prev.variant_normalised,
      year: year ? parseInt(year, 10) : prev.year,
    }));
  }, [searchParams]);

  // Polling config (explicit)
  const POLL_MAX_ATTEMPTS = 6;
  const POLL_DELAY_MS = 400;

  // Helper to verify hunt was created and redirect
  const verifyHuntAndRedirect = async (
    saleId: string, 
    mustHaveRaw?: string,
    mustHaveTokens?: string[],
    mustHaveMode?: 'soft' | 'strict',
    bodyType?: string,
    badge?: string
  ): Promise<boolean> => {
    // Poll for hunt creation (trigger may have slight delay)
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const { data: huntId } = await (supabase as any).rpc('get_hunt_for_sale', { p_sale_id: saleId });
      
      if (huntId) {
        // Build update payload
        const updatePayload: Record<string, unknown> = {};
        
        if (mustHaveTokens && mustHaveTokens.length > 0) {
          updatePayload.must_have_raw = mustHaveRaw;
          updatePayload.must_have_tokens = mustHaveTokens;
          updatePayload.must_have_mode = mustHaveMode || 'soft';
        }
        
        if (bodyType) {
          updatePayload.body_type = bodyType.toUpperCase();
        }
        
        if (badge) {
          updatePayload.badge = badge.toUpperCase();
        }
        
        // Update hunt with additional fields if any
        if (Object.keys(updatePayload).length > 0) {
          await (supabase as any)
            .from('sale_hunts')
            .update(updatePayload)
            .eq('id', huntId);
        }
        
        // Show engaging animation briefly before redirect
        setKitingEngaged(true);
        toast({
          title: "✅ Kiting Mode engaged",
          description: "Hunting for replicas now. Redirecting to hunt...",
        });
        // Small delay to show the animation
        await new Promise(resolve => setTimeout(resolve, 800));
        navigate(`/hunts/${huntId}`);
        return true;
      }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
    }
    
    // Auto-arm fallback: try to create hunt once before showing manual button
    console.log('[KitingMode] Polling failed, attempting auto-arm...');
    const { data: fallbackHuntId, error } = await (supabase as any).rpc('create_hunt_from_sale', { 
      p_sale_id: saleId 
    });
    
    if (!error && fallbackHuntId) {
      // Build update payload
      const updatePayload: Record<string, unknown> = {};
      
      if (mustHaveTokens && mustHaveTokens.length > 0) {
        updatePayload.must_have_raw = mustHaveRaw;
        updatePayload.must_have_tokens = mustHaveTokens;
        updatePayload.must_have_mode = mustHaveMode || 'soft';
      }
      
      if (bodyType) {
        updatePayload.body_type = bodyType.toUpperCase();
      }
      
      if (badge) {
        updatePayload.badge = badge.toUpperCase();
      }
      
      if (Object.keys(updatePayload).length > 0) {
        await (supabase as any)
          .from('sale_hunts')
          .update(updatePayload)
          .eq('id', fallbackHuntId);
      }
      
      setKitingEngaged(true);
      toast({
        title: "✅ Kiting Mode engaged",
        description: "Hunt auto-armed successfully. Redirecting...",
      });
      await new Promise(resolve => setTimeout(resolve, 800));
      navigate(`/hunts/${fallbackHuntId}`);
      return true;
    }
    
    console.warn('[KitingMode] Auto-arm failed:', error);
    return false;
  };

  // Manual fallback to arm Kiting Mode
  const handleArmKitingMode = async () => {
    if (!failedHuntSaleId) return;
    
    setIsArmingHunt(true);
    try {
      const { data: huntId, error } = await (supabase as any).rpc('create_hunt_from_sale', { 
        p_sale_id: failedHuntSaleId 
      });
      
      if (error) throw error;
      
      if (huntId) {
        toast({
          title: "✅ Kiting Mode engaged",
          description: "Hunt armed successfully. Redirecting...",
        });
        setFailedHuntSaleId(null);
        navigate(`/hunts/${huntId}`);
      } else {
        throw new Error('Failed to create hunt');
      }
    } catch (error) {
      toast({
        title: "Failed to arm Kiting Mode",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setIsArmingHunt(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.dealer_name || !formData.make || !formData.model || !formData.variant_normalised) {
      toast({
        title: "Missing required fields",
        description: "Please fill in dealer, make, model, and variant.",
        variant: "destructive",
      });
      return;
    }

    // Sell price is required for Kiting Mode
    if (!formData.sell_price) {
      toast({
        title: "Sell price required",
        description: "Enter a sell price to activate Kiting Mode (proven exit value).",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setFailedHuntSaleId(null);
    
    try {
      // Use the linked dealer profile - this is the authoritative source
      if (!isDealerLinked) {
        toast({
          title: "Dealer profile required",
          description: "Link your account to a dealer profile to activate Kiting Mode.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }
      
      const dealerId = dealerProfile!.dealer_profile_id;
      const dealerName = dealerProfile!.dealer_name;
      
      // 1. Insert into dealer_sales (triggers auto hunt creation)
      // Map engine_code to engine_litres and cylinders
      let engineLitres: number | null = null;
      let cylinders: number | null = null;
      if (formData.engine_code === 'VDJ') {
        engineLitres = 4.5;
        cylinders = 8;
      } else if (formData.engine_code === 'GDJ') {
        engineLitres = 2.8;
        cylinders = 4;
      } else if (formData.engine_code === 'GRJ') {
        engineLitres = 4.0;
        cylinders = 6;
      }

      const { data: insertedSale, error: insertError } = await (supabase as any)
        .from('dealer_sales')
        .insert({
          dealer_id: dealerId,
          dealer_name: dealerName,
          sold_date: formData.sale_date,
          make: formData.make.toUpperCase(),
          model: formData.model.toUpperCase(),
          variant_raw: formData.variant_normalised,
          year: formData.year,
          km: formData.sale_km,
          buy_price: formData.buy_price ? parseFloat(formData.buy_price) : null,
          sell_price: formData.sell_price ? parseFloat(formData.sell_price) : null,
          data_source: 'DEALER_UPLOAD',
          // LC79 Precision Pack fields
          engine_code: formData.engine_code || null,
          cab_type: formData.cab_type || null,
          engine_litres: engineLitres,
          cylinders: cylinders,
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      
      const saleId = insertedSale.id;
      
      // Helper function to normalize must-have tokens
      const normalizeMustHaveTokens = (raw: string): string[] => {
        if (!raw.trim()) return [];
        const synonymMap: Record<string, string> = {
          'NORWELL': 'NORWELD',
          'NORWELD TRAY': 'NORWELD',
          'ALLOY TRAY': 'ALLOY',
          'STEEL TRAY': 'STEEL',
        };
        return raw
          .split(/[,\n]+/)
          .map(t => t.trim().toUpperCase())
          .filter(Boolean)
          .map(t => synonymMap[t] || t);
      };
      
      // If must-have keywords provided, update the hunt after it's created
      const mustHaveTokens = normalizeMustHaveTokens(formData.must_have_raw);

      // 2. Also sync to legacy systems (fingerprints)
      await dataService.upsertFingerprint({
        dealer_name: dealerName,
        dealer_whatsapp: '',
        sale_date: formData.sale_date,
        make: formData.make,
        model: formData.model,
        variant_normalised: formData.variant_normalised,
        year: formData.year,
        sale_km: formData.sale_km,
        engine: formData.engine,
        drivetrain: formData.drivetrain,
        transmission: formData.transmission,
        shared_opt_in: formData.shared_opt_in ? 'Y' : 'N',
      });

      // 3. Verify hunt was created and redirect (pass must-have data, body type, and badge)
      const huntCreated = await verifyHuntAndRedirect(
        saleId,
        formData.must_have_raw,
        mustHaveTokens,
        formData.must_have_mode,
        formData.body_type,
        formData.badge
      );
      
      if (!huntCreated) {
        // Hunt didn't create - show fallback
        setFailedHuntSaleId(saleId);
        toast({
          title: "Sale saved",
          description: "Sale logged but hunt failed to arm. Click 'Arm Kiting Mode' to retry.",
          variant: "destructive",
        });
      }

      // Refresh recent sales
      const sales = await dataService.getSalesLog(50);
      setRecentSales(sales);

      // Reset form (only if hunt was created)
      if (huntCreated) {
        setFormData({
          dealer_name: formData.dealer_name, // Keep dealer selected
          sale_date: format(new Date(), 'yyyy-MM-dd'),
          make: '',
          model: '',
          variant_normalised: '',
          year: new Date().getFullYear(),
          sale_km: 0,
          engine: '',
          drivetrain: '',
          transmission: '',
          shared_opt_in: false,
          buy_price: '',
          sell_price: '',
          badge: '',
          body_type: '',
          engine_code: '',
          cab_type: '',
          must_have_raw: '',
          must_have_mode: 'soft',
        });
      }
    } catch (error) {
      console.error('Sale submission error:', error);
      toast({
        title: "Failed to log sale",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = <K extends keyof typeof formData>(key: K, value: typeof formData[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const selectedDealer = dealers.find(d => d.dealer_name === formData.dealer_name);

  // Common makes for quick selection
  const commonMakes = ['Toyota', 'Ford', 'Mazda', 'Hyundai', 'Kia', 'Volkswagen', 'Mitsubishi', 'Nissan', 'Honda', 'Subaru'];
  const engines = ['Petrol', 'Diesel', 'Petrol Turbo', 'Hybrid', 'Electric'];
  const drivetrains = ['FWD', 'RWD', 'AWD', '4WD'];
  const transmissions = ['Automatic', 'Manual', 'CVT', 'DCT'];

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KitingWingMarkVideo size={48} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Sales Log</h1>
              <p className="text-muted-foreground mt-1">
                Log sales and automatically sync fingerprints for matching
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setShowCsvImport(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </div>

        {/* Kiting Mode Engagement Animation */}
        {kitingEngaged && (
          <div className="mb-6 p-6 rounded-lg bg-primary/10 border border-primary/20 animate-fade-in">
            <div className="flex items-center gap-4">
              <KitingIndicator state="scanning" size="lg" showLabel={false} />
              <div>
                <h3 className="text-lg font-semibold text-primary">Kiting Mode Engaged</h3>
                <p className="text-sm text-muted-foreground">
                  Hunting for replicas of your sale. Redirecting to hunt...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Dealer Link Prompt - show if user not linked */}
        {user && !isDealerLinked && !kitingEngaged && (
          <div className="mb-6">
            <DealerLinkPrompt />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Log Sale Form */}
          <form onSubmit={handleSubmit}>
            <Card className={`bg-card border-border ${!isDealerLinked ? 'opacity-60 pointer-events-none' : ''}`}>
              <CardHeader>
                <CardTitle className="text-lg">Log New Sale</CardTitle>
                <CardDescription>
                  {isDealerLinked 
                    ? `Logging as ${dealerProfile?.dealer_name}. Fingerprint will be active for 120 days.`
                    : 'Link your dealer profile above to enable sales logging.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Dealer display (read-only when linked) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dealer">Dealer</Label>
                    <Input
                      id="dealer"
                      value={dealerProfile?.dealer_name || formData.dealer_name}
                      readOnly={isDealerLinked}
                      onChange={(e) => !isDealerLinked && updateField('dealer_name', e.target.value)}
                      placeholder={isDealerLinked ? '' : "Link dealer profile above"}
                      className={`bg-input ${isDealerLinked ? 'bg-muted cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sale_date">Deposit Date *</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="sale_date"
                        type="date"
                        value={formData.sale_date}
                        onChange={(e) => updateField('sale_date', e.target.value)}
                        className="bg-input pl-10"
                      />
                    </div>
                  </div>
                </div>

                {/* Vehicle Identity */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Car className="h-4 w-4 text-primary" />
                    Vehicle Identity
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="make">Make *</Label>
                      <Input
                        id="make"
                        value={formData.make}
                        onChange={(e) => updateField('make', e.target.value)}
                        placeholder="Type or select make"
                        list="make-list"
                        className="bg-input"
                      />
                      <datalist id="make-list">
                        {commonMakes.map(make => (
                          <option key={make} value={make} />
                        ))}
                      </datalist>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="model">Model *</Label>
                      <Input
                        id="model"
                        value={formData.model}
                        onChange={(e) => updateField('model', e.target.value)}
                        placeholder="Type or select model"
                        list="model-list"
                        className="bg-input"
                      />
                      <datalist id="model-list">
                        {/* Get unique models from recent sales, properly capitalized */}
                        {[...new Set(recentSales
                          .map(s => s.model?.trim())
                          .filter(Boolean)
                          .map(m => m!.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' '))
                        )].map(model => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="variant">Variant *</Label>
                      <Input
                        id="variant"
                        value={formData.variant_normalised}
                        onChange={(e) => updateField('variant_normalised', e.target.value)}
                        placeholder="e.g. SR5, Wildtrak"
                        className="bg-input"
                      />
                    </div>
                  </div>
                  
                  {/* Trim/Badge field - optional but helps precision */}
                  <div className="space-y-2">
                    <Label htmlFor="badge">Trim / Badge (optional)</Label>
                    <Input
                      id="badge"
                      value={formData.badge}
                      onChange={(e) => updateField('badge', e.target.value)}
                      placeholder="e.g. Premium, Elite, GXL, Workmate, N Line"
                      className="bg-input"
                      list="badge-list"
                    />
                    <datalist id="badge-list">
                      {BADGE_PATTERNS.slice(0, 20).map(b => (
                        <option key={b} value={b.replace(/-/g, ' ')} />
                      ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">
                      Leaving this blank still works, but matches may be broader.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="year">Year *</Label>
                      <Input
                        id="year"
                        type="number"
                        min={2000}
                        max={2030}
                        value={formData.year}
                        onChange={(e) => updateField('year', parseInt(e.target.value))}
                        className="bg-input mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sale_km">Odometer (km) *</Label>
                      <Input
                        id="sale_km"
                        type="number"
                        min={0}
                        value={formData.sale_km}
                        onChange={(e) => updateField('sale_km', parseInt(e.target.value))}
                        placeholder="e.g. 45000"
                        className="bg-input mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Will match vehicles up to {(formData.sale_km + 15000).toLocaleString()} km
                      </p>
                    </div>
                  </div>
                </div>

                {/* Specs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="engine">Engine *</Label>
                    <Select
                      value={formData.engine}
                      onValueChange={(v) => updateField('engine', v)}
                    >
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {engines.map(e => (
                          <SelectItem key={e} value={e}>{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="drivetrain">Drivetrain *</Label>
                    <Select
                      value={formData.drivetrain}
                      onValueChange={(v) => updateField('drivetrain', v)}
                    >
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {drivetrains.map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="transmission">Transmission *</Label>
                    <Select
                      value={formData.transmission}
                      onValueChange={(v) => updateField('transmission', v)}
                    >
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {transmissions.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Body Type - Universal for all vehicles */}
                <div className="space-y-2">
                  <Label htmlFor="body_type">Body Type (optional)</Label>
                  <Select
                    value={formData.body_type}
                    onValueChange={(v) => updateField('body_type', v)}
                  >
                    <SelectTrigger className="bg-input">
                      <SelectValue placeholder="Select body type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNSPECIFIED">Not specified</SelectItem>
                      <SelectItem value="SEDAN">Sedan</SelectItem>
                      <SelectItem value="HATCH">Hatchback</SelectItem>
                      <SelectItem value="WAGON">Wagon</SelectItem>
                      <SelectItem value="SUV">SUV</SelectItem>
                      <SelectItem value="UTE">Ute</SelectItem>
                      <SelectItem value="SINGLE_CAB">Single Cab Ute</SelectItem>
                      <SelectItem value="DUAL_CAB">Dual Cab Ute</SelectItem>
                      <SelectItem value="EXTRA_CAB">Extra Cab Ute</SelectItem>
                      <SelectItem value="VAN">Van</SelectItem>
                      <SelectItem value="COUPE">Coupe</SelectItem>
                      <SelectItem value="CONVERTIBLE">Convertible</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Helps Kiting Mode avoid mismatches (e.g. sedan vs hatch, single vs dual cab)
                  </p>
                </div>

                {/* Variant-Critical Fields - Engine & Cab Type (conditional) */}
                {isVariantCritical && (
                  <div className="space-y-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      {isLC79Series ? 'LandCruiser 70/79 Series' : 'Nissan Patrol'} — Precision Matching
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Providing engine and cab helps Kiting Mode avoid incorrect matches.
                      {!formData.engine_code && !formData.cab_type && (
                        <span className="block mt-1 text-amber-600">
                          Without this info, some matches may be hidden or downgraded to WATCH only.
                        </span>
                      )}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="engine_code">Engine (recommended)</Label>
                        <Select
                          value={formData.engine_code}
                          onValueChange={(v) => updateField('engine_code', v)}
                        >
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select engine" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLC79Series ? (
                              <>
                                <SelectItem value="VDJ">V8 Diesel (4.5L)</SelectItem>
                                <SelectItem value="GDJ">4cyl Diesel (2.8L)</SelectItem>
                                <SelectItem value="GRJ">V6 Petrol (4.0L)</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="TD42">4.2L Diesel (TD42)</SelectItem>
                                <SelectItem value="ZD30">3.0L Diesel (ZD30)</SelectItem>
                                <SelectItem value="TB48">4.8L Petrol (TB48)</SelectItem>
                              </>
                            )}
                            <SelectItem value="UNKNOWN">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="cab_type">Cab / Body (recommended)</Label>
                        <Select
                          value={formData.cab_type}
                          onValueChange={(v) => updateField('cab_type', v)}
                        >
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select cab/body type" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLC79Series ? (
                              <>
                                <SelectItem value="SINGLE">Single Cab</SelectItem>
                                <SelectItem value="DUAL">Dual Cab</SelectItem>
                                <SelectItem value="EXTRA">Extra Cab</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="WAGON">Wagon</SelectItem>
                                <SelectItem value="UTE">Ute</SelectItem>
                                <SelectItem value="CAB_CHASSIS">Cab Chassis</SelectItem>
                              </>
                            )}
                            <SelectItem value="UNKNOWN">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Prices */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Pricing
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="buy_price">Buy Price</Label>
                      <Input
                        id="buy_price"
                        type="number"
                        value={formData.buy_price}
                        onChange={(e) => updateField('buy_price', e.target.value)}
                        placeholder="e.g. 35000"
                        className="bg-input mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sell_price" className="flex items-center gap-1">
                        Sell Price <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="sell_price"
                        type="number"
                        value={formData.sell_price}
                        onChange={(e) => updateField('sell_price', e.target.value)}
                        placeholder="e.g. 42000"
                        className="bg-input mono"
                        required
                      />
                      <p className="text-xs text-muted-foreground">Required for Kiting Mode</p>
                    </div>
                  </div>
                </div>

                {/* Sharing opt-in */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border">
                  <div>
                    <Label htmlFor="shared" className="font-medium">Share with other dealers</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Allow other dealers to see matching opportunities
                    </p>
                  </div>
                  <Switch
                    id="shared"
                    checked={formData.shared_opt_in}
                    onCheckedChange={(v) => updateField('shared_opt_in', v)}
                  />
                </div>

                {/* What Matters? - Intent keywords for web discovery */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Target className="h-4 w-4 text-primary" />
                    What matters? (optional)
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Input
                        id="must_have_raw"
                        value={formData.must_have_raw}
                        onChange={(e) => updateField('must_have_raw', e.target.value)}
                        placeholder="e.g. V8 only, dual cab, Norweld tray, GVM upgrade, diff locks"
                        className="bg-input"
                      />
                      <p className="text-xs text-muted-foreground">
                        Tell us what the buyer requires. This feeds our AI search across the web.
                      </p>
                    </div>
                    
                    {/* Mode selector - only show if text entered */}
                    {formData.must_have_raw.trim() && (
                      <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border">
                        <div className="flex-1">
                          <Label className="font-medium text-sm">Match mode</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formData.must_have_mode === 'strict' 
                              ? 'Keywords MUST appear in listing — otherwise excluded'
                              : 'Keywords boost score but don\'t block matches'}
                          </p>
                        </div>
                        <Select
                          value={formData.must_have_mode}
                          onValueChange={(v) => updateField('must_have_mode', v as 'soft' | 'strict')}
                        >
                          <SelectTrigger className="w-[140px] bg-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="soft">Soft (boost)</SelectItem>
                            <SelectItem value="strict">Strict (must match)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>

                {/* Kiting Mode Info */}
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-start gap-2">
                    <Target className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-emerald-700 dark:text-emerald-400">
                      <p className="font-medium">
                        Logging a sale automatically activates Kiting Mode™
                      </p>
                      <p className="text-xs mt-1 text-emerald-600/80 dark:text-emerald-500/80">
                        All major outlets are continuously scanned (auctions + retail).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Failed Hunt Fallback */}
                {failedHuntSaleId && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between">
                      <span>Sale saved, but hunt failed to arm.</span>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={handleArmKitingMode}
                        disabled={isArmingHunt}
                        className="ml-4"
                      >
                        <Target className="h-4 w-4 mr-2" />
                        {isArmingHunt ? 'Arming...' : 'Arm Kiting Mode'}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/')}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="action"
                    disabled={isSubmitting || !isDealerLinked}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {!isDealerLinked 
                      ? 'Link Dealer First' 
                      : isSubmitting 
                        ? 'Engaging Kiting Mode...' 
                        : 'Log Sale & Hunt'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>

          {/* Recent Sales */}
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Recent Sales
                  </CardTitle>
                  <CardDescription>
                    Last 50 logged sales
                  </CardDescription>
                </div>
                <Select value={salesDealerFilter} onValueChange={setSalesDealerFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by dealer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Dealers</SelectItem>
                    {dealers
                      .filter(dealer => dealer.dealer_name)
                      .map(dealer => (
                        <SelectItem key={dealer.dealer_name} value={dealer.dealer_name}>
                          {dealer.dealer_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loadingSales ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : recentSales.filter(s => salesDealerFilter === 'all' || s.dealer_name === salesDealerFilter).length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales logged yet.</p>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentSales
                        .filter(sale => salesDealerFilter === 'all' || sale.dealer_name === salesDealerFilter)
                        .map((sale) => (
                        <TableRow key={sale.sale_id}>
                          <TableCell className="font-mono text-sm">
                            {sale.deposit_date}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">
                              {sale.year} {sale.make} {sale.model}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {sale.variant_normalised} • {sale.km?.toLocaleString()} km
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={sale.source === 'CSV' ? 'secondary' : 'outline'}>
                              {sale.source}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SalesCsvImport
        open={showCsvImport}
        onOpenChange={setShowCsvImport}
        dealerName={formData.dealer_name}
        dealerWhatsapp={selectedDealer?.whatsapp || ''}
        onImportComplete={loadData}
      />
    </AppLayout>
  );
}