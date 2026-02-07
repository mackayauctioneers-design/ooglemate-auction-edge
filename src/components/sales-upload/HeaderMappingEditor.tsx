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
import { CheckCircle, Info, ArrowRight, Sparkles } from "lucide-react";
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

// Key identity fields — we suggest mapping these but don't block on them
const IDENTITY_FIELDS = ["sold_at", "make", "model", "description"];

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
  const mappedValues = Object.values(mapping).filter(Boolean);

  // Check if we have enough identity: either make+model OR description
  const hasMakeModel = mappedValues.includes("make") && mappedValues.includes("model");
  const hasDescription = mappedValues.includes("description");
  const hasVehicleIdentity = hasMakeModel || hasDescription;
  const hasSaleDate = mappedValues.includes("sold_at");

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

  const methodLabel = aiMethod === "ai"
    ? "AI-suggested"
    : aiMethod === "saved_profile"
    ? "Saved profile"
    : aiMethod === "heuristic" || aiMethod === "heuristic_fallback"
    ? "Auto-detected"
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              We think we've mapped your columns
              {methodLabel && (
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {methodLabel}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Confirm or adjust how your columns map to our fields. Nothing is rejected — adjust what doesn't look right.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mapping rows */}
        <div className="space-y-2">
          {headers.map((header) => {
            const currentValue = mapping[header];
            const sampleValue = sampleRow?.[header];

            return (
              <div
                key={header}
                className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm truncate">{header}</p>
                  {sampleValue && (
                    <p className="text-xs text-muted-foreground truncate">
                      e.g. "{sampleValue}"
                    </p>
                  )}
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

                <div className="w-52">
                  <Select
                    value={currentValue || "__skip__"}
                    onValueChange={(v) => handleFieldChange(header, v)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">
                        <span className="text-muted-foreground">Skip</span>
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
                  {currentValue ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <span className="h-4 w-4 block" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Soft guidance — not blocking */}
        {(!hasVehicleIdentity || !hasSaleDate) && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Tip: Map these for best results</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                {!hasSaleDate && <li>Sale Date — when the vehicle was sold</li>}
                {!hasVehicleIdentity && (
                  <li>Vehicle Description or Make + Model — to identify the vehicle</li>
                )}
              </ul>
              <p className="text-xs mt-1 opacity-75">You can still import without these — we won't reject your data.</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? "Importing…" : "Confirm & Import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
