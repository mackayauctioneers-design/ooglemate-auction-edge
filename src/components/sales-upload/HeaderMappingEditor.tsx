import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CheckCircle, ArrowRight, Sparkles, ChevronDown, ChevronRight, Info } from "lucide-react";
import { type HeaderMapping, CANONICAL_FIELDS } from "@/hooks/useHeaderMapping";

interface HeaderMappingEditorProps {
  headers: string[];
  mapping: HeaderMapping;
  sampleRow?: Record<string, string>;
  aiMethod?: string;
  onMappingChange: (mapping: HeaderMapping) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
}

// Fields grouped by intent
const REQUIRED_FIELDS = new Set([
  "sold_at", "sale_price", "make", "model", "series", "badge", "year", "km",
]);
const HELPFUL_FIELDS = new Set([
  "variant", "buy_price", "gross_profit", "transmission", "fuel_type", "body_type",
  "acquired_at", "colour", "rego", "vin", "stock_no", "description",
]);
// Everything else (location, dealer_name, notes, etc.) is "ignored"

function classifyHeader(
  header: string,
  mappedTo: string | null
): "required" | "helpful" | "ignored" {
  if (!mappedTo) return "ignored";
  if (REQUIRED_FIELDS.has(mappedTo)) return "required";
  if (HELPFUL_FIELDS.has(mappedTo)) return "helpful";
  return "ignored";
}

function MappingRow({
  header,
  currentValue,
  sampleValue,
  onChange,
}: {
  header: string;
  currentValue: string | null;
  sampleValue?: string;
  onChange: (header: string, value: string) => void;
}) {
  const isMapped = !!currentValue;

  return (
    <div
      className={`flex items-center gap-3 py-2 px-3 rounded-md ${
        isMapped ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-muted/30"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm truncate">{header}</p>
        {sampleValue && (
          <p className="text-xs text-muted-foreground truncate">
            e.g. &quot;{sampleValue}&quot;
          </p>
        )}
      </div>

      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

      <div className="w-52">
        <Select
          value={currentValue || "__skip__"}
          onValueChange={(v) => onChange(header, v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__skip__">
              <span className="text-muted-foreground italic">Not used for analysis</span>
            </SelectItem>
            {CANONICAL_FIELDS.map((field) => (
              <SelectItem key={field.value} value={field.value}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-5 shrink-0">
        {isMapped ? (
          <CheckCircle className="h-4 w-4 text-emerald-500" />
        ) : (
          <span className="h-4 w-4 block" />
        )}
      </div>
    </div>
  );
}

export function HeaderMappingEditor({
  headers,
  mapping,
  sampleRow,
  aiMethod,
  onMappingChange,
  onConfirm,
  onCancel,
  isConfirming,
}: HeaderMappingEditorProps) {
  const [showHelpful, setShowHelpful] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const mappedValues = Object.values(mapping).filter(Boolean);

  // Check if we have enough identity — structured fields required
  const hasMakeModel = mappedValues.includes("make") && mappedValues.includes("model");
  const hasSeries = mappedValues.includes("series");
  const hasBadge = mappedValues.includes("badge");
  const hasVehicleIdentity = hasMakeModel;
  const hasSaleDate = mappedValues.includes("sold_at");
  const hasYear = mappedValues.includes("year");

  const handleFieldChange = (sourceHeader: string, canonicalField: string) => {
    const newMapping = { ...mapping };
    if (canonicalField === "__skip__") {
      newMapping[sourceHeader] = null;
    } else {
      // Remove any other header mapped to this field
      for (const key of Object.keys(newMapping)) {
        if (newMapping[key] === canonicalField) {
          newMapping[key] = null;
        }
      }
      newMapping[sourceHeader] = canonicalField;
    }
    onMappingChange(newMapping);
  };

  // Split headers into groups
  const requiredHeaders: string[] = [];
  const helpfulHeaders: string[] = [];
  const ignoredHeaders: string[] = [];

  for (const header of headers) {
    const group = classifyHeader(header, mapping[header]);
    if (group === "required") requiredHeaders.push(header);
    else if (group === "helpful") helpfulHeaders.push(header);
    else ignoredHeaders.push(header);
  }

  const totalMapped = mappedValues.length;
  const methodLabel =
    aiMethod === "ai"
      ? "AI-interpreted"
      : aiMethod === "saved_profile"
      ? "Saved profile"
      : aiMethod === "heuristic" || aiMethod === "heuristic_fallback"
      ? "Auto-detected"
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              We&apos;ve automatically interpreted this file
              {methodLabel && (
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {methodLabel}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              Please confirm the highlighted fields before importing.
              {totalMapped > 0 && (
                <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  {totalMapped} field{totalMapped !== 1 ? "s" : ""} mapped automatically.
                </span>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Soft guidance — only if critical fields missing */}
        {(!hasVehicleIdentity || !hasSaleDate || !hasYear) && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Needs your confirmation</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                {!hasSaleDate && <li>Sale Date — when the vehicle was sold</li>}
                {!hasVehicleIdentity && (
                  <li>Make + Model — required structured fields for replication engine</li>
                )}
                {!hasYear && <li>Year — required for matching</li>}
                {!hasSeries && <li>Series — recommended for precise fingerprinting</li>}
                {!hasBadge && <li>Badge — recommended for precise fingerprinting</li>}
              </ul>
              <p className="text-xs text-muted-foreground mt-2 italic">
                💡 Structured fields drive the replication engine. Description is display only.
              </p>
            </div>
          </div>
        )}

        {/* Section 1: Required for analysis */}
        {requiredHeaders.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              Required for analysis
            </h3>
            {requiredHeaders.map((header) => (
              <MappingRow
                key={header}
                header={header}
                currentValue={mapping[header]}
                sampleValue={sampleRow?.[header]}
                onChange={handleFieldChange}
              />
            ))}
          </div>
        )}

        {/* Section 2: Helpful if present (collapsible) */}
        {helpfulHeaders.length > 0 && (
          <Collapsible open={showHelpful} onOpenChange={setShowHelpful}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors w-full text-left py-1">
                {showHelpful ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Helpful if present
                <Badge variant="outline" className="text-xs ml-1">
                  {helpfulHeaders.length}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {helpfulHeaders.map((header) => (
                <MappingRow
                  key={header}
                  header={header}
                  currentValue={mapping[header]}
                  sampleValue={sampleRow?.[header]}
                  onChange={handleFieldChange}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Section 3: Not used (collapsed by default) */}
        {ignoredHeaders.length > 0 && (
          <Collapsible open={showIgnored} onOpenChange={setShowIgnored}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground/80 transition-colors w-full text-left py-1">
                {showIgnored ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Not used for analysis
                <Badge variant="outline" className="text-xs ml-1">
                  {ignoredHeaders.length}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {ignoredHeaders.map((header) => (
                <MappingRow
                  key={header}
                  header={header}
                  currentValue={mapping[header]}
                  sampleValue={sampleRow?.[header]}
                  onChange={handleFieldChange}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? "Importing…" : "Confirm & Import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
