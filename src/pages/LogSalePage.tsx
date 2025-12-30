import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Dealer } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { FileText, Save, Calendar, Car } from 'lucide-react';
import { format } from 'date-fns';

export default function LogSalePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
  });

  useEffect(() => {
    const loadDealers = async () => {
      const dealerList = await dataService.getDealers();
      setDealers(dealerList.filter(d => d.enabled === 'Y'));
    };
    loadDealers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.dealer_name || !formData.make || !formData.model) {
      toast({
        title: "Missing required fields",
        description: "Please fill in dealer, make, and model.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const dealer = dealers.find(d => d.dealer_name === formData.dealer_name);
      
      await dataService.addFingerprint({
        dealer_name: formData.dealer_name,
        dealer_whatsapp: dealer?.whatsapp || '',
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

      toast({
        title: "Sale logged successfully",
        description: `Fingerprint created for ${formData.year} ${formData.make} ${formData.model}. Active for 120 days.`,
      });

      // Reset form
      setFormData({
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
      });
    } catch (error) {
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

  // Common makes for quick selection
  const commonMakes = ['Toyota', 'Ford', 'Mazda', 'Hyundai', 'Kia', 'Volkswagen', 'Mitsubishi', 'Nissan', 'Honda', 'Subaru'];
  const engines = ['Petrol', 'Diesel', 'Petrol Turbo', 'Hybrid', 'Electric'];
  const drivetrains = ['FWD', 'RWD', 'AWD', '4WD'];
  const transmissions = ['Automatic', 'Manual', 'CVT', 'DCT'];

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            Log Sale (Deposit Taken)
          </h1>
          <p className="text-muted-foreground mt-1">
            Create a fingerprint to match future auction opportunities
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Sale Details</CardTitle>
              <CardDescription>
                Enter the vehicle details from the sale. The system will create a fingerprint active for 120 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dealer and Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dealer">Dealer *</Label>
                  <Select
                    value={formData.dealer_name}
                    onValueChange={(v) => updateField('dealer_name', v)}
                  >
                    <SelectTrigger className="bg-input">
                      <SelectValue placeholder="Select dealer" />
                    </SelectTrigger>
                    <SelectContent>
                      {dealers.map(dealer => (
                        <SelectItem key={dealer.dealer_name} value={dealer.dealer_name}>
                          {dealer.dealer_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sale_date">Sale Date</Label>
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
                    <Select
                      value={formData.make}
                      onValueChange={(v) => updateField('make', v)}
                    >
                      <SelectTrigger className="bg-input">
                        <SelectValue placeholder="Select make" />
                      </SelectTrigger>
                      <SelectContent>
                        {commonMakes.map(make => (
                          <SelectItem key={make} value={make}>{make}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model">Model *</Label>
                    <Input
                      id="model"
                      value={formData.model}
                      onChange={(e) => updateField('model', e.target.value)}
                      placeholder="e.g. Hilux, Ranger"
                      className="bg-input"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="variant">Variant</Label>
                    <Input
                      id="variant"
                      value={formData.variant_normalised}
                      onChange={(e) => updateField('variant_normalised', e.target.value)}
                      placeholder="e.g. SR5, Wildtrak"
                      className="bg-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year">Year</Label>
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
                    <Label htmlFor="sale_km">Odometer (km)</Label>
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
                  <Label htmlFor="engine">Engine</Label>
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
                  <Label htmlFor="drivetrain">Drivetrain</Label>
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
                  <Label htmlFor="transmission">Transmission</Label>
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

              {/* Sharing opt-in */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border">
                <div>
                  <Label htmlFor="shared" className="font-medium">Share with other dealers</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Allow other dealers to see matching opportunities for this fingerprint
                  </p>
                </div>
                <Switch
                  id="shared"
                  checked={formData.shared_opt_in}
                  onCheckedChange={(v) => updateField('shared_opt_in', v)}
                />
              </div>

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
                  disabled={isSubmitting}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSubmitting ? 'Saving...' : 'Log Sale'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </AppLayout>
  );
}
