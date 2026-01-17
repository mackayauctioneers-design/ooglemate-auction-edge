import { useState } from "react";
import { Copy, Check, ExternalLink, Search, MapPin, Car, Gauge, DollarSign, Smartphone, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface IdKit {
  vin?: string | null;
  rego?: string | null;
  stock_no?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  badge?: string | null;
  variant?: string | null;
  km?: number | null;
  price?: number | null;
  location?: string | null;
  state?: string | null;
  colour?: string | null;
  body?: string | null;
  cab?: string | null;
  engine?: string | null;
  how_to_find?: string;
  photo_clues?: string[];
  search_string?: string;
}

interface CarsalesIdKitModalProps {
  title: string;
  domain: string;
  idKit?: IdKit | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  km?: number | null;
  price?: number | null;
  location?: string | null;
}

export function CarsalesIdKitModal({
  title,
  domain,
  idKit,
  year,
  make,
  model,
  variant,
  km,
  price,
  location,
}: CarsalesIdKitModalProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Merge ID kit with fallback props
  const effectiveKit: IdKit = {
    ...idKit,
    year: idKit?.year ?? year,
    make: idKit?.make ?? make,
    model: idKit?.model ?? model,
    variant: idKit?.variant ?? variant,
    km: idKit?.km ?? km,
    price: idKit?.price ?? price,
    location: idKit?.location ?? location,
  };

  // Build search string
  const buildSearchString = (): string => {
    const parts: string[] = [];
    if (effectiveKit.year) parts.push(String(effectiveKit.year));
    if (effectiveKit.make) parts.push(effectiveKit.make);
    if (effectiveKit.model) parts.push(effectiveKit.model);
    if (effectiveKit.badge) parts.push(effectiveKit.badge);
    if (effectiveKit.variant) parts.push(effectiveKit.variant);
    if (effectiveKit.km) parts.push(`${effectiveKit.km.toLocaleString()}km`);
    if (effectiveKit.location) parts.push(effectiveKit.location);
    return parts.join(" ");
  };

  const searchString = effectiveKit.search_string || buildSearchString();

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast.success(`${fieldName} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      toast.error("Failed to copy to clipboard");
    }
  };

  const hasVinOrRego = !!(effectiveKit.vin || effectiveKit.rego || effectiveKit.stock_no);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          Find in App
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            Find in Carsales App
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Blocked site notice */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-700">Direct link blocked</p>
              <p className="text-amber-600/80 text-xs mt-0.5">
                {domain} blocks automated access. Use the ID kit below to find it manually.
              </p>
            </div>
          </div>

          {/* Vehicle identity */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <p className="font-medium text-sm line-clamp-2">{title}</p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {effectiveKit.year && <span>{effectiveKit.year}</span>}
              {effectiveKit.make && <span>{effectiveKit.make}</span>}
              {effectiveKit.model && <span>{effectiveKit.model}</span>}
              {effectiveKit.badge && (
                <Badge variant="outline" className="text-xs">
                  {effectiveKit.badge}
                </Badge>
              )}
            </div>
          </div>

          {/* Option A: VIN/Rego found */}
          {hasVinOrRego && (
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                Quick ID Found
              </h4>
              
              {effectiveKit.vin && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-200">
                  <div>
                    <p className="text-xs text-muted-foreground">VIN</p>
                    <p className="font-mono text-lg font-bold tracking-wide">{effectiveKit.vin}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(effectiveKit.vin!, "VIN")}
                  >
                    {copiedField === "VIN" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}

              {effectiveKit.rego && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-200">
                  <div>
                    <p className="text-xs text-muted-foreground">Registration</p>
                    <p className="font-mono text-lg font-bold tracking-wide">{effectiveKit.rego}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(effectiveKit.rego!, "Rego")}
                  >
                    {copiedField === "Rego" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}

              {effectiveKit.stock_no && !effectiveKit.vin && !effectiveKit.rego && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-200">
                  <div>
                    <p className="text-xs text-muted-foreground">Stock No.</p>
                    <p className="font-mono text-lg font-bold">{effectiveKit.stock_no}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(effectiveKit.stock_no!, "Stock No")}
                  >
                    {copiedField === "Stock No" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Open Carsales app → Search → Paste the ID above
              </p>
            </div>
          )}

          {/* Option B: No VIN/Rego - provide search string and filters */}
          {!hasVinOrRego && (
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Search String
              </h4>

              <div className="flex items-start justify-between gap-2 p-3 rounded-lg border bg-background">
                <p className="text-sm font-medium flex-1">{searchString}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(searchString, "Search")}
                >
                  {copiedField === "Search" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              {/* Filters to apply */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Filters to apply:</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {effectiveKit.year && (
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">Year:</span>
                      <span className="font-medium">{effectiveKit.year}</span>
                    </div>
                  )}
                  {effectiveKit.km && (
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <Gauge className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{effectiveKit.km.toLocaleString()} km</span>
                    </div>
                  )}
                  {effectiveKit.price && (
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <DollarSign className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">${effectiveKit.price.toLocaleString()}</span>
                    </div>
                  )}
                  {(effectiveKit.location || effectiveKit.state) && (
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{effectiveKit.location || effectiveKit.state}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Photo clues */}
              {effectiveKit.photo_clues && effectiveKit.photo_clues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Look for:</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {effectiveKit.photo_clues.map((clue, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {clue}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search other sites */}
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">Try searching on other sites:</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://www.autotrader.com.au/cars?q=${encodeURIComponent(searchString)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Autotrader <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`https://www.drive.com.au/search?search=${encodeURIComponent(searchString)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Drive <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`https://www.gumtree.com.au/s-cars-vans-utes/c18320?search=${encodeURIComponent(searchString)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Gumtree <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
