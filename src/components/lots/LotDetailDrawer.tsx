import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { X, ExternalLink, Pencil, Link2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuctionLot, formatCurrency, formatNumber, getLotFlagReasons, LotFlagReason } from '@/types';
import { dataService } from '@/services/dataService';
import { toast } from '@/hooks/use-toast';

const AEST_TIMEZONE = 'Australia/Sydney';

interface LotDetailDrawerProps {
  lot: AuctionLot;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUpdated?: () => void;
}

const flagColors: Record<LotFlagReason, string> = {
  'PASSED IN x3+': 'bg-red-600',
  'PASSED IN x2': 'bg-orange-600',
  'UNDER-SPECIFIED': 'bg-yellow-600',
  'RESERVE SOFTENING': 'bg-purple-600',
  'MARGIN OK': 'bg-emerald-600',
  'PRICE DROPPING': 'bg-blue-600',
  'FATIGUE LISTING': 'bg-rose-600',
  'RELISTED': 'bg-cyan-600',
};

export function LotDetailDrawer({ lot, isAdmin, onClose, onEdit, onUpdated }: LotDetailDrawerProps) {
  const flagReasons = getLotFlagReasons(lot);
  const [relistGroupId, setRelistGroupId] = useState(lot.relist_group_id || '');
  const [isSavingRelist, setIsSavingRelist] = useState(false);

  const formatDate = (datetime: string) => {
    if (!datetime) return '-';
    try {
      const date = parseISO(datetime);
      const aestDate = toZonedTime(date, AEST_TIMEZONE);
      return format(aestDate, 'EEEE, d MMMM yyyy h:mm a') + ' AEST';
    } catch {
      return datetime;
    }
  };

  const formatTimestamp = (datetime: string) => {
    if (!datetime) return '-';
    try {
      const date = parseISO(datetime);
      const aestDate = toZonedTime(date, AEST_TIMEZONE);
      return format(aestDate, 'd MMM yyyy h:mm a');
    } catch {
      return datetime;
    }
  };

  const handleSaveRelistGroup = async () => {
    setIsSavingRelist(true);
    try {
      await dataService.updateLot({
        ...lot,
        relist_group_id: relistGroupId,
      });
      toast({ title: 'Relist group updated' });
      onUpdated?.();
    } catch (error) {
      toast({ 
        title: 'Error saving', 
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive' 
      });
    } finally {
      setIsSavingRelist(false);
    }
  };

  return (
    <Sheet open={true} onOpenChange={() => onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle className="text-left">
              {lot.year} {lot.make} {lot.model}
            </SheetTitle>
            <div className="flex gap-2 shrink-0">
              {isAdmin && (
                <Button variant="outline" size="iconSm" onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="iconSm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground text-left">
            {lot.variant_normalised || lot.variant_raw}
          </p>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Action Badge */}
          <div className="flex items-center gap-3">
            <Badge
              className={`text-sm px-3 py-1 ${lot.action === 'Buy' ? 'bg-emerald-600' : 'bg-amber-600'}`}
            >
              {lot.action}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Confidence: {lot.confidence_score}/4
            </span>
          </div>

          {/* Why Flagged */}
          {flagReasons.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Why Flagged</h3>
              <div className="flex flex-wrap gap-2">
                {flagReasons.map((reason) => (
                  <Badge key={reason} className={`${flagColors[reason]} text-white text-xs`}>
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Lifecycle Panel */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Lifecycle</h3>
            <div className="grid grid-cols-2 gap-3 text-sm bg-muted/50 p-3 rounded-lg">
              <div>
                <span className="text-muted-foreground">Current Status:</span>
                <p className="font-medium capitalize">{lot.status.replace('_', ' ')}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last Status:</span>
                <p className="font-medium capitalize">{lot.last_status ? lot.last_status.replace('_', ' ') : '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Pass Count:</span>
                <p className="font-medium">{lot.pass_count}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last Seen:</span>
                <p className="font-medium text-xs">{formatTimestamp(lot.last_seen_at)}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Updated:</span>
                <p className="font-medium text-xs">{formatTimestamp(lot.updated_at)}</p>
              </div>
            </div>
          </div>

          {/* Admin: Relist Group ID */}
          {isAdmin && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">Relist Group ID</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={relistGroupId}
                  onChange={(e) => setRelistGroupId(e.target.value)}
                  placeholder="Link re-runs of same vehicle..."
                  className="text-sm"
                />
                <Button 
                  size="sm" 
                  onClick={handleSaveRelistGroup}
                  disabled={isSavingRelist || relistGroupId === lot.relist_group_id}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this to link multiple lot_ids that represent the same physical vehicle across re-listings.
              </p>
            </div>
          )}

          <Separator />

          {/* Auction Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Auction Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">House:</span>
                <p className="font-medium">{lot.auction_house}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Location:</span>
                <p className="font-medium">{lot.location}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Date:</span>
                <p className="font-medium">{formatDate(lot.auction_datetime)}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Vehicle Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Vehicle Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Make:</span>
                <p className="font-medium">{lot.make}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Model:</span>
                <p className="font-medium">{lot.model}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Variant (Raw):</span>
                <p className="font-medium">{lot.variant_raw || '-'}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Variant (Normalised):</span>
                <p className="font-medium">{lot.variant_normalised || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Year:</span>
                <p className="font-medium">{lot.year}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Kilometres:</span>
                <p className="font-medium">{formatNumber(lot.km)} km</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fuel:</span>
                <p className="font-medium">{lot.fuel || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Drivetrain:</span>
                <p className="font-medium">{lot.drivetrain || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Transmission:</span>
                <p className="font-medium">{lot.transmission || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Description Score:</span>
                <p className="font-medium">{lot.description_score}/4</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Pricing */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Pricing & Margin</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Reserve:</span>
                <p className="font-medium">{formatCurrency(lot.reserve)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Highest Bid:</span>
                <p className="font-medium">{formatCurrency(lot.highest_bid)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Est. Get Out:</span>
                <p className="font-medium">{formatCurrency(lot.estimated_get_out)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Est. Margin:</span>
                <p className="font-medium text-emerald-500">{formatCurrency(lot.estimated_margin)}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Meta */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Meta</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Lot Key:</span>
                <p className="font-medium font-mono text-xs">{lot.lot_key}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Lot ID:</span>
                <p className="font-medium font-mono text-xs">{lot.lot_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Event ID:</span>
                <p className="font-medium font-mono text-xs">{lot.event_id || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Visible to Dealers:</span>
                <p className="font-medium">{lot.visible_to_dealers === 'Y' ? 'Yes' : 'No'}</p>
              </div>
              {lot.relist_group_id && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Relist Group:</span>
                  <p className="font-medium font-mono text-xs">{lot.relist_group_id}</p>
                </div>
              )}
            </div>
          </div>

          {/* Open Listing Button */}
          {lot.listing_url && (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={() => window.open(lot.listing_url, '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
              Open Listing
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}