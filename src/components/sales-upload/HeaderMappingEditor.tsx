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
import { CheckCircle, AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
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
  const requiredFields = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.value);
  const mappedValues = Object.values(mapping).filter(Boolean);
  const missingRequired = requiredFields.filter((f) => !mappedValues.includes(f));

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Map Your Columns
              {aiMethod === "ai" && (
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI-suggested
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Confirm how your file columns map to our sales fields. Adjust any that don't look right.
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

                <div className="w-48">
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
                          {field.required && " *"}
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

        {/* Validation */}
        {missingRequired.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Required fields not mapped:{" "}
              {missingRequired
                .map((f) => CANONICAL_FIELDS.find((c) => c.value === f)?.label)
                .join(", ")}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={missingRequired.length > 0 || isConfirming}
          >
            {isConfirming ? "Importing..." : "Confirm & Import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
