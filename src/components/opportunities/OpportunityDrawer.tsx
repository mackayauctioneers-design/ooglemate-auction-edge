import { AuctionLot, getLotFlagReasons, formatCurrency, formatNumber } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ExternalLink, Calendar, Gauge, MapPin, Building2, AlertTriangle, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';

interface OpportunityDrawerProps {
  lot: AuctionLot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpportunityDrawer({ lot, open, onOpenChange }: OpportunityDrawerProps) {
  if (!lot) return null;

  const flagReasons = getLotFlagReasons(lot);
  
  const getConfidenceBadge = (score: number) => {
    if (score >= 3) return <Badge variant="confidence-high">{score}/5</Badge>;
    if (score >= 2) return <Badge variant="confidence-mid">{score}/5</Badge>;
    return <Badge variant="confidence-low">{score}/5</Badge>;
  };

  const getStatusBadge = (status: AuctionLot['status']) => {
    const variants: Record<string, "passed" | "sold" | "listed" | "withdrawn"> = {
      passed_in: 'passed',
      sold: 'sold',
      listed: 'listed',
      withdrawn: 'withdrawn',
    };
    return <Badge variant={variants[status]}>{status.replace('_', ' ').toUpperCase()}</Badge>;
  };

  const formatAuctionDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), 'dd MMM yyyy, HH:mm');
    } catch {
      return dateStr;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg bg-card border-l border-border overflow-y-auto">
        <SheetHeader className="space-y-4 pb-6 border-b border-border">
          <div className="flex items-center justify-between">
            <Badge variant={lot.action === 'Buy' ? 'buy' : 'watch'}>
              {lot.action}
            </Badge>
            {getConfidenceBadge(lot.confidence_score)}
          </div>
          
          <SheetTitle className="text-left">
            <span className="text-2xl font-bold text-foreground">
              {lot.year} {lot.make} {lot.model}
            </span>
            <p className="text-base font-normal text-muted-foreground mt-1">
              {lot.variant_normalised}
            </p>
          </SheetTitle>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {lot.auction_house}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {lot.location}
            </span>
            <span className="flex items-center gap-1.5">
              <Gauge className="h-4 w-4" />
              {formatNumber(lot.km)} km
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {formatAuctionDate(lot.auction_datetime)}
            </span>
          </div>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Why Flagged */}
          {flagReasons.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-action-watch" />
                Why Flagged
              </h3>
              <div className="flex flex-wrap gap-2">
                {flagReasons.map((reason, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {reason}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Pricing */}
          <section className="grid grid-cols-2 gap-4">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Reserve</p>
              <p className="text-xl font-bold text-foreground mono">{formatCurrency(lot.reserve)}</p>
              {lot.previous_reserve && lot.previous_reserve > lot.reserve && (
                <p className="text-xs text-primary flex items-center gap-1 mt-1">
                  <TrendingDown className="h-3 w-3" />
                  from {formatCurrency(lot.previous_reserve)}
                </p>
              )}
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Highest Bid</p>
              <p className="text-xl font-bold text-foreground mono">{formatCurrency(lot.highest_bid)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Est. Get Out</p>
              <p className="text-xl font-bold text-foreground mono">{formatCurrency(lot.estimated_get_out)}</p>
            </div>
            <div className="stat-card bg-primary/10 border-primary/30">
              <p className="text-xs text-primary uppercase tracking-wide">Est. Margin</p>
              <p className="text-xl font-bold text-primary mono">{formatCurrency(lot.estimated_margin)}</p>
            </div>
          </section>

          {/* Vehicle Details */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3">Vehicle Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Fuel</p>
                <p className="font-medium text-foreground">{lot.fuel || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Drivetrain</p>
                <p className="font-medium text-foreground">{lot.drivetrain || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Transmission</p>
                <p className="font-medium text-foreground">{lot.transmission || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Description Score</p>
                <p className="font-medium text-foreground">{lot.description_score}/4</p>
              </div>
            </div>
          </section>

          {/* Status History */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3">Status</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Status</span>
                {getStatusBadge(lot.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pass Count</span>
                <span className="font-medium text-foreground">{lot.pass_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {lot.updated_at ? format(new Date(lot.updated_at), 'dd MMM yyyy, HH:mm') : '-'}
                </span>
              </div>
            </div>
          </section>

          {/* Actions */}
          <section className="pt-4 border-t border-border">
            <Button asChild className="w-full" variant="action">
              <a href={lot.listing_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open Listing
              </a>
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
