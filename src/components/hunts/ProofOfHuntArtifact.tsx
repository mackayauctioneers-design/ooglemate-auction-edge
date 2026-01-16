import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  Target, 
  Clock, 
  Radar, 
  Zap, 
  TrendingUp,
  Share2,
  Download,
  ExternalLink,
  CheckCircle2
} from "lucide-react";
import { formatDistanceToNow, differenceInDays, differenceInHours, format } from "date-fns";
import type { SaleHunt, HuntAlert, HuntScan } from "@/types/hunts";
import { parseHuntAlertPayload } from "@/types/hunts";

interface ProofOfHuntArtifactProps {
  hunt: SaleHunt;
  strikeAlert: HuntAlert; // The successful BUY alert
  scans: HuntScan[];
  onShare?: () => void;
  onExport?: () => void;
  compact?: boolean;
}

export function ProofOfHuntArtifact({
  hunt,
  strikeAlert,
  scans,
  onShare,
  onExport,
  compact = false
}: ProofOfHuntArtifactProps) {
  const payloadResult = parseHuntAlertPayload(strikeAlert.payload);
  
  if (!payloadResult.success) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6 text-center text-muted-foreground">
          Invalid strike data
        </CardContent>
      </Card>
    );
  }

  const payload = payloadResult.data;

  // Calculate hunt duration
  const huntCreated = new Date(hunt.created_at);
  const strikeTime = new Date(strikeAlert.created_at);
  const daysHunting = differenceInDays(strikeTime, huntCreated);
  const hoursHunting = differenceInHours(strikeTime, huntCreated);
  const huntDuration = daysHunting > 0 
    ? `${daysHunting} day${daysHunting !== 1 ? 's' : ''}`
    : `${hoursHunting} hour${hoursHunting !== 1 ? 's' : ''}`;

  // Calculate markets scanned
  const uniqueSources = new Set(scans.map(s => s.source).filter(Boolean));
  const totalCandidates = scans.reduce((sum, s) => sum + (s.candidates_checked || 0), 0);
  const totalScans = scans.length;

  // Margin calculation
  const askingPrice = payload.asking_price || 0;
  const provenExit = payload.proven_exit_value || hunt.proven_exit_value || 0;
  const marginDollars = payload.gap_dollars || (provenExit - askingPrice);
  const marginPct = payload.gap_pct || (provenExit > 0 ? ((marginDollars / provenExit) * 100) : 0);

  // Source display
  const source = payload.source || 'Unknown';
  const isOutward = source.toLowerCase().includes('outward');

  if (compact) {
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <div className="font-semibold">
                  {hunt.year} {hunt.make} {hunt.model}
                </div>
                <div className="text-sm text-muted-foreground">
                  Found in {huntDuration} • ${marginDollars.toLocaleString()} margin
                </div>
              </div>
            </div>
            <Badge className="bg-emerald-500 text-white">
              +{marginPct.toFixed(1)}%
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/30 via-background to-background dark:from-emerald-950/10 overflow-hidden">
      {/* Header ribbon */}
      <div className="bg-emerald-500 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          <span className="font-semibold">Kiting Mode™ Strike</span>
        </div>
        <Badge variant="secondary" className="bg-white/20 text-white border-0">
          Verified
        </Badge>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* Sale Fingerprint */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Target className="h-4 w-4" />
            SALE FINGERPRINT
          </div>
          <div className="text-2xl font-bold">
            {hunt.year} {hunt.make} {hunt.model}
          </div>
          {hunt.variant_family && (
            <div className="text-muted-foreground">{hunt.variant_family}</div>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {hunt.km && (
              <Badge variant="outline">{(hunt.km / 1000).toFixed(0)}k km</Badge>
            )}
            {hunt.fuel && <Badge variant="outline">{hunt.fuel}</Badge>}
            {hunt.transmission && <Badge variant="outline">{hunt.transmission}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            Proven exit: <span className="font-semibold text-foreground">${provenExit.toLocaleString()}</span>
          </div>
        </div>

        <Separator />

        {/* Hunt Duration */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              TIME HUNTING
            </div>
            <div className="text-xl font-bold">{huntDuration}</div>
            <div className="text-xs text-muted-foreground">
              Started {format(huntCreated, 'MMM d')}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Radar className="h-3.5 w-3.5" />
              MARKETS SCANNED
            </div>
            <div className="text-xl font-bold">{uniqueSources.size}</div>
            <div className="text-xs text-muted-foreground">
              {totalCandidates.toLocaleString()} candidates
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              TOTAL SCANS
            </div>
            <div className="text-xl font-bold">{totalScans}</div>
            <div className="text-xs text-muted-foreground">
              Automated runs
            </div>
          </div>
        </div>

        <Separator />

        {/* Strike Found */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Zap className="h-4 w-4 text-emerald-500" />
            STRIKE FOUND
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">
                {payload.year || hunt.year} {payload.make || hunt.make} {payload.model || hunt.model}
              </div>
              <div className="text-sm text-muted-foreground">
                {payload.variant || hunt.variant_family || 'Unknown variant'}
              </div>
            </div>
            <Badge className={isOutward ? "bg-purple-500" : "bg-blue-500"}>
              {source}
            </Badge>
          </div>
          
          <div className="flex items-center gap-4 mt-2">
            {payload.km && (
              <span className="text-sm">{(payload.km / 1000).toFixed(0)}k km</span>
            )}
            {(payload.state || payload.suburb) && (
              <span className="text-sm text-muted-foreground">
                📍 {payload.suburb || ''}{payload.suburb && payload.state ? ', ' : ''}{payload.state || ''}
              </span>
            )}
          </div>

          <div className="mt-3 p-3 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Asking price</div>
              <div className="font-semibold">${askingPrice.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Margin Captured */}
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-200">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-2">
            <TrendingUp className="h-4 w-4" />
            MARGIN CAPTURED
          </div>
          <div className="flex items-center justify-between">
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              ${marginDollars.toLocaleString()}
            </div>
            <Badge className="bg-emerald-500 text-white text-lg px-3 py-1">
              +{marginPct.toFixed(1)}%
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            vs. your proven exit of ${provenExit.toLocaleString()}
          </div>
        </div>

        {/* Footer with timestamp */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <span>
            Strike detected {formatDistanceToNow(strikeTime, { addSuffix: true })}
          </span>
          <span>
            {format(strikeTime, 'MMM d, yyyy • h:mm a')}
          </span>
        </div>

        {/* Actions */}
        {(onShare || onExport) && (
          <>
            <Separator />
            <div className="flex gap-2">
              {onShare && (
                <Button variant="outline" className="flex-1" onClick={onShare}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
              )}
              {onExport && (
                <Button variant="outline" className="flex-1" onClick={onExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              )}
              {payload.listing_url && (
                <Button variant="outline" asChild>
                  <a href={payload.listing_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/* Carbitrage branding */}
      <div className="bg-muted/50 px-6 py-3 text-center border-t">
        <span className="text-xs text-muted-foreground">
          Powered by <span className="font-semibold text-foreground">Carbitrage™</span> Kiting Mode
        </span>
      </div>
    </Card>
  );
}
