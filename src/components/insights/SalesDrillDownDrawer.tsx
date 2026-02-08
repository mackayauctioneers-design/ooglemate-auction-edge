import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { useSalesDrillDown, buildSpecBreakdown, type YearBandRow, type SpecRow } from "@/hooks/useSalesDrillDown";

const RANGE_LABELS: Record<string, string> = {
  "3": "3 months",
  "6": "6 months",
  "12": "12 months",
  "all": "all time",
};

function formatPrice(p: number | null) {
  if (p == null) return "—";
  return `$${p.toLocaleString()}`;
}

function profitBadge(dollars: number | null) {
  if (dollars == null) return <span className="text-muted-foreground text-xs">—</span>;
  const label = `$${Math.abs(dollars).toLocaleString()}`;
  if (dollars >= 5000) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{label} — higher margin</Badge>;
  if (dollars >= 1000) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{label}</Badge>;
  if (dollars >= 0) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{label} — thin margin</Badge>;
  return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">-{label} — lower realised margin</Badge>;
}

function clearanceBadge(days: number | null) {
  if (days == null) return <span className="text-muted-foreground text-xs">—</span>;
  if (days <= 21) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{days}d — clears quickly</Badge>;
  if (days <= 45) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{days}d — clears consistently</Badge>;
  return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{days}d — longer clearance observed</Badge>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  make: string;
  model: string;
  accountId: string;
  range: string;
}

export function SalesDrillDownDrawer({ open, onOpenChange, make, model, accountId, range }: Props) {
  const rangeMonths = range === "all" ? null : parseInt(range);
  const { data, isLoading } = useSalesDrillDown(accountId, make, model, rangeMonths);

  const [selectedBand, setSelectedBand] = useState<YearBandRow | null>(null);
  const [specData, setSpecData] = useState<SpecRow[]>([]);

  const handleBandClick = (band: YearBandRow) => {
    if (!data?.rawRows) return;
    if (band.salesCount < 3) return; // not enough data
    const specs = buildSpecBreakdown(data.rawRows as any, band.yearMin, band.yearMax);
    setSpecData(specs);
    setSelectedBand(band);
  };

  const handleBack = () => {
    setSelectedBand(null);
    setSpecData([]);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedBand(null);
      setSpecData([]);
    }
    onOpenChange(isOpen);
  };

  const totalSales = data?.yearBands?.reduce((s, b) => s + b.salesCount, 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg">
            {selectedBand ? (
              <button onClick={handleBack} className="flex items-center gap-2 text-left hover:text-primary transition-colors">
                <ArrowLeft className="h-4 w-4" />
                {make} {model} — {selectedBand.yearBand}
              </button>
            ) : (
              <span>{make} {model}</span>
            )}
          </SheetTitle>
          <SheetDescription>
            {selectedBand
              ? `Spec breakdown for ${selectedBand.yearBand} (${selectedBand.salesCount} sales)`
              : `${totalSales} completed sales over the last ${RANGE_LABELS[range]}. Different generations of the same model can behave very differently.`}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading breakdown…</p>
          </div>
        ) : selectedBand ? (
          <SpecBreakdownTable data={specData} />
        ) : (
          <YearBandTable
            bands={data?.yearBands || []}
            onBandClick={handleBandClick}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function YearBandTable({ bands, onBandClick }: { bands: YearBandRow[]; onBandClick: (b: YearBandRow) => void }) {
  if (!bands.length) {
    return (
      <p className="text-center text-muted-foreground py-12">
        No year-level data available for this vehicle.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Year Band</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Median Price</TableHead>
          <TableHead className="text-right">Median Margin</TableHead>
          <TableHead className="text-right">Clearance</TableHead>
          <TableHead className="w-8"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bands.map((band) => {
          const canDrill = band.salesCount >= 3;
          return (
            <TableRow
              key={band.yearBand}
              className={canDrill ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
              onClick={() => canDrill && onBandClick(band)}
            >
              <TableCell className="font-medium">{band.yearBand}</TableCell>
              <TableCell className="text-right font-mono">{band.salesCount}</TableCell>
              <TableCell className="text-right">{formatPrice(band.medianSalePrice)}</TableCell>
              <TableCell className="text-right">{profitBadge(band.medianProfitDollars)}</TableCell>
              <TableCell className="text-right">{clearanceBadge(band.medianDaysToClear)}</TableCell>
              <TableCell>
                {canDrill ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">n&lt;3</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SpecBreakdownTable({ data }: { data: SpecRow[] }) {
  if (!data.length) {
    return (
      <p className="text-center text-muted-foreground py-12">
        Limited data for deeper breakdown.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Spec</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Median Price</TableHead>
          <TableHead className="text-right">Median Margin</TableHead>
          <TableHead className="text-right">Clearance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const specParts = [row.variant, row.transmission, row.fuelType].filter(Boolean);
          const specLabel = specParts.length ? specParts.join(" · ") : "Unspecified";
          return (
            <TableRow key={i}>
              <TableCell className="font-medium text-sm">{specLabel}</TableCell>
              <TableCell className="text-right font-mono">{row.salesCount}</TableCell>
              <TableCell className="text-right">{formatPrice(row.medianSalePrice)}</TableCell>
              <TableCell className="text-right">
                {row.medianProfitDollars !== null
                  ? profitBadge(row.medianProfitDollars)
                  : <span className="text-muted-foreground text-[10px] italic">Insufficient data</span>}
              </TableCell>
              <TableCell className="text-right">{clearanceBadge(row.medianDaysToClear)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
