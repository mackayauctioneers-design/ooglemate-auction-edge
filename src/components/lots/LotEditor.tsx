import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { dataService } from '@/services/dataService';
import { AuctionLot } from '@/types';
import { toast } from '@/hooks/use-toast';

interface LotEditorProps {
  lot: AuctionLot | null;
  onClose: () => void;
  onSaved: () => void;
}

export function LotEditor({ lot, onClose, onSaved }: LotEditorProps) {
  const isEditing = !!lot;
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    event_id: lot?.event_id || '',
    auction_house: lot?.auction_house || '',
    location: lot?.location || '',
    auction_datetime: lot?.auction_datetime || '',
    listing_url: lot?.listing_url || '',
    make: lot?.make || '',
    model: lot?.model || '',
    variant_raw: lot?.variant_raw || '',
    variant_normalised: lot?.variant_normalised || '',
    year: lot?.year?.toString() || '',
    km: lot?.km?.toString() || '',
    fuel: lot?.fuel || '',
    drivetrain: lot?.drivetrain || '',
    transmission: lot?.transmission || '',
    reserve: lot?.reserve?.toString() || '',
    highest_bid: lot?.highest_bid?.toString() || '',
    status: lot?.status || 'listed',
    pass_count: lot?.pass_count?.toString() || '0',
    description_score: lot?.description_score?.toString() || '0',
    estimated_get_out: lot?.estimated_get_out?.toString() || '',
    estimated_margin: lot?.estimated_margin?.toString() || '',
    visible_to_dealers: lot?.visible_to_dealers === 'Y',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const lotData: any = {
        event_id: formData.event_id,
        auction_house: formData.auction_house,
        location: formData.location,
        auction_datetime: formData.auction_datetime,
        listing_url: formData.listing_url,
        make: formData.make,
        model: formData.model,
        variant_raw: formData.variant_raw,
        variant_normalised: formData.variant_normalised,
        year: parseInt(formData.year) || 0,
        km: parseInt(formData.km) || 0,
        fuel: formData.fuel,
        drivetrain: formData.drivetrain,
        transmission: formData.transmission,
        reserve: parseFloat(formData.reserve) || 0,
        highest_bid: parseFloat(formData.highest_bid) || 0,
        status: formData.status as 'listed' | 'passed_in' | 'sold' | 'withdrawn',
        pass_count: parseInt(formData.pass_count) || 0,
        description_score: parseInt(formData.description_score) || 0,
        estimated_get_out: parseFloat(formData.estimated_get_out) || 0,
        estimated_margin: parseFloat(formData.estimated_margin) || 0,
        visible_to_dealers: formData.visible_to_dealers ? 'Y' : 'N',
      };

      if (isEditing && lot) {
        await dataService.updateLot({
          ...lot,
          ...lotData,
        });
        toast({ title: 'Lot updated successfully' });
      } else {
        await dataService.addLot(lotData);
        toast({ title: 'Lot added successfully' });
      }

      onSaved();
    } catch (error) {
      toast({
        title: 'Error saving lot',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Lot' : 'Add New Lot'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Auction Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Auction House *</Label>
              <Input
                value={formData.auction_house}
                onChange={(e) => setFormData({ ...formData, auction_house: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location *</Label>
              <Input
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auction DateTime (ISO)</Label>
              <Input
                type="datetime-local"
                value={formData.auction_datetime.slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, auction_datetime: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Event ID</Label>
              <Input
                value={formData.event_id}
                onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              />
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Make *</Label>
              <Input
                value={formData.make}
                onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Model *</Label>
              <Input
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Year</Label>
              <Input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Variant (Raw)</Label>
              <Input
                value={formData.variant_raw}
                onChange={(e) => setFormData({ ...formData, variant_raw: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Variant (Normalised)</Label>
              <Input
                value={formData.variant_normalised}
                onChange={(e) => setFormData({ ...formData, variant_normalised: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">KM</Label>
              <Input
                type="number"
                value={formData.km}
                onChange={(e) => setFormData({ ...formData, km: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fuel</Label>
              <Input
                value={formData.fuel}
                onChange={(e) => setFormData({ ...formData, fuel: e.target.value })}
                placeholder="Petrol, Diesel..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Drivetrain</Label>
              <Input
                value={formData.drivetrain}
                onChange={(e) => setFormData({ ...formData, drivetrain: e.target.value })}
                placeholder="AWD, FWD..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Transmission</Label>
              <Input
                value={formData.transmission}
                onChange={(e) => setFormData({ ...formData, transmission: e.target.value })}
                placeholder="Auto, Manual..."
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Reserve</Label>
              <Input
                type="number"
                value={formData.reserve}
                onChange={(e) => setFormData({ ...formData, reserve: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Highest Bid</Label>
              <Input
                type="number"
                value={formData.highest_bid}
                onChange={(e) => setFormData({ ...formData, highest_bid: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Est. Get Out</Label>
              <Input
                type="number"
                value={formData.estimated_get_out}
                onChange={(e) => setFormData({ ...formData, estimated_get_out: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Est. Margin</Label>
              <Input
                type="number"
                value={formData.estimated_margin}
                onChange={(e) => setFormData({ ...formData, estimated_margin: e.target.value })}
              />
            </div>
          </div>

          {/* Status & Scores */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="listed">Listed</SelectItem>
                  <SelectItem value="passed_in">Passed In</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                  <SelectItem value="withdrawn">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Pass Count</Label>
              <Input
                type="number"
                min="0"
                value={formData.pass_count}
                onChange={(e) => setFormData({ ...formData, pass_count: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Desc. Score (0-4)</Label>
              <Input
                type="number"
                min="0"
                max="4"
                value={formData.description_score}
                onChange={(e) => setFormData({ ...formData, description_score: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Listing URL</Label>
              <Input
                value={formData.listing_url}
                onChange={(e) => setFormData({ ...formData, listing_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>

          {/* Visibility */}
          <div className="flex items-center gap-3 pt-2">
            <Switch
              checked={formData.visible_to_dealers}
              onCheckedChange={(checked) => setFormData({ ...formData, visible_to_dealers: checked })}
            />
            <Label className="text-sm">Visible to Dealers</Label>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="w-full sm:w-auto gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? 'Update Lot' : 'Add Lot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}