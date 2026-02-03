import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Info, Car, Gauge, Calendar, Cog } from "lucide-react";
import { cn } from "@/lib/utils";

interface VehicleIntelligenceCardProps {
  make: string | null;
  model: string | null;
  yearMin: number | null;
  yearMax: number | null;
  variant: string | null;
  transmission: string | null;
  fuelType: string | null;
  bodyType: string | null;
  confidence: "high" | "medium" | "low";
  knownIssues: string[];
  avoidedIssues: string[];
  whyThisMatters: string;
  vin?: string | null;
  className?: string;
}

export function VehicleIntelligenceCard({
  make,
  model,
  yearMin,
  yearMax,
  variant,
  transmission,
  fuelType,
  bodyType,
  confidence,
  knownIssues,
  avoidedIssues,
  whyThisMatters,
  vin,
  className,
}: VehicleIntelligenceCardProps) {
  const confidenceColors = {
    high: "bg-green-500/20 text-green-700 border-green-500/30",
    medium: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
    low: "bg-red-500/20 text-red-700 border-red-500/30",
  };

  const yearDisplay = yearMin && yearMax
    ? yearMin === yearMax
      ? yearMin.toString()
      : `${yearMin}-${yearMax}`
    : yearMin || yearMax || "Unknown";

  const vehicleTitle = [make, model, variant].filter(Boolean).join(" ") || "Unknown Vehicle";

  return (
    <Card className={cn("border-2", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            <CardTitle className="text-xl">{vehicleTitle}</CardTitle>
          </div>
          <Badge className={cn("capitalize", confidenceColors[confidence])}>
            {confidence} Confidence
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-4 pt-2">
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {yearDisplay}
          </span>
          {transmission && (
            <span className="flex items-center gap-1">
              <Cog className="h-4 w-4" />
              {transmission}
            </span>
          )}
          {fuelType && (
            <span className="flex items-center gap-1">
              <Gauge className="h-4 w-4" />
              {fuelType}
            </span>
          )}
          {bodyType && <span className="capitalize">{bodyType}</span>}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* VIN Display */}
        {vin && (
          <div className="bg-muted/50 rounded-md p-3">
            <p className="text-xs text-muted-foreground mb-1">VIN</p>
            <p className="font-mono text-sm tracking-wide">{vin}</p>
          </div>
        )}

        {/* Why This Matters */}
        <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-primary mb-1">Why This Matters</p>
              <p className="text-sm text-muted-foreground">{whyThisMatters}</p>
            </div>
          </div>
        </div>

        {/* Known Issues */}
        {knownIssues.length > 0 && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive mb-2">Known Issues to Check</p>
                <ul className="space-y-1">
                  {knownIssues.map((issue, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-destructive">•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Avoided Issues */}
        {avoidedIssues.length > 0 && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-md p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-700 mb-2">Issues Avoided</p>
                <ul className="space-y-1">
                  {avoidedIssues.map((issue, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-green-600">✓</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* No issues found */}
        {knownIssues.length === 0 && (
          <div className="bg-muted/30 border border-border rounded-md p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-sm">No known issues in database for this model</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
