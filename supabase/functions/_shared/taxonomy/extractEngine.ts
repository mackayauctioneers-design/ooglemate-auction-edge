/**
 * Engine Type Extraction — First-class vehicle identity attribute
 *
 * Extracts canonical engine_type from listing text (title, variant_raw, etc.)
 * using a two-layer approach:
 *   1. Model-specific rules (highest precision)
 *   2. Generic pattern fallback
 *
 * Returns engine_type and confidence (HIGH/MEDIUM/LOW).
 *
 * Examples:
 *   "Ranger Wildtrak 3.0L V6"        → { engine_type: "3.0 V6 DIESEL", confidence: "HIGH" }
 *   "Ranger Wildtrak V6"             → { engine_type: "3.0 V6 DIESEL", confidence: "HIGH" }
 *   "Ranger Sport 2.0 Bi-Turbo"      → { engine_type: "2.0 BITURBO DIESEL", confidence: "HIGH" }
 *   "LandCruiser 300 Sahara"         → { engine_type: null, confidence: "LOW" }
 */

export interface EngineExtraction {
  engine_type: string | null;
  engine_confidence: "HIGH" | "MEDIUM" | "LOW";
  fuel_type_hint: string | null;
}

// ─── Model-specific engine rules (checked first, highest priority) ──────────
// Each rule: [regex pattern, canonical engine_type, fuel_type, confidence]
type EngineRule = [RegExp, string, string | null, "HIGH" | "MEDIUM"];

const MODEL_RULES: Record<string, Record<string, EngineRule[]>> = {
  FORD: {
    RANGER: [
      [/\b3\.0\s*L?\s*V6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bV6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.0\b/, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.0\s*L?\s*BI[\s-]?TURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\bBI[\s-]?TURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\bBITURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\b2\.0\b/, "2.0 BITURBO DIESEL", "DIESEL", "MEDIUM"],
    ],
    EVEREST: [
      [/\b3\.0\s*L?\s*V6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bV6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.0\b/, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.0\s*L?\s*BI[\s-]?TURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\bBI[\s-]?TURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\bBITURBO\b/i, "2.0 BITURBO DIESEL", "DIESEL", "HIGH"],
      [/\b2\.0\b/, "2.0 BITURBO DIESEL", "DIESEL", "MEDIUM"],
    ],
    MUSTANG: [
      [/\b5\.0\b/, "5.0 V8 PETROL", "PETROL", "HIGH"],
      [/\bV8\b/i, "5.0 V8 PETROL", "PETROL", "HIGH"],
      [/\b2\.3\b/, "2.3 ECOBOOST PETROL", "PETROL", "HIGH"],
      [/\bECOBOOST\b/i, "2.3 ECOBOOST PETROL", "PETROL", "HIGH"],
    ],
  },
  TOYOTA: {
    LANDCRUISER: [
      [/\b3\.3\s*L?\s*V6\b/i, "3.3 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.3\b/, "3.3 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bV6\s*DIESEL\b/i, "3.3 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.5\s*L?\s*V6\b/i, "3.5 V6 PETROL", "PETROL", "HIGH"],
      [/\b3\.5\b/, "3.5 V6 PETROL", "PETROL", "HIGH"],
      [/\bV6\s*PETROL\b/i, "3.5 V6 PETROL", "PETROL", "HIGH"],
      [/\bV6\b/i, "V6", null, "MEDIUM"], // ambiguous — could be diesel or petrol
      [/\b4\.5\s*L?\s*V8\b/i, "4.5 V8 DIESEL", "DIESEL", "HIGH"],
      [/\b4\.5\b/, "4.5 V8 DIESEL", "DIESEL", "HIGH"],
      [/\bV8\s*DIESEL\b/i, "4.5 V8 DIESEL", "DIESEL", "HIGH"],
      [/\b4\.6\b/, "4.6 V8 PETROL", "PETROL", "HIGH"],
      [/\bV8\s*PETROL\b/i, "4.6 V8 PETROL", "PETROL", "HIGH"],
      [/\bV8\b/i, "V8", null, "MEDIUM"],
    ],
    PRADO: [
      [/\b2\.8\s*L?\b/i, "2.8 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.7\s*L?\b/i, "2.7 PETROL", "PETROL", "HIGH"],
      [/\b2\.4\s*L?\s*HYBRID\b/i, "2.4 HYBRID", "HYBRID", "HIGH"],
      [/\bHYBRID\b/i, "2.4 HYBRID", "HYBRID", "MEDIUM"],
    ],
    HILUX: [
      [/\b2\.8\s*L?\b/i, "2.8 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.4\s*L?\b/i, "2.4 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.7\s*L?\b/i, "2.7 PETROL", "PETROL", "HIGH"],
    ],
    COROLLA: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.0\b/, "2.0 PETROL", "PETROL", "MEDIUM"],
      [/\b1\.8\b/, "1.8 PETROL", "PETROL", "HIGH"],
    ],
    RAV4: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.5\b/, "2.5 PETROL", "PETROL", "MEDIUM"],
      [/\b2\.0\b/, "2.0 PETROL", "PETROL", "MEDIUM"],
    ],
    KLUGER: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b3\.5\b/, "3.5 V6 PETROL", "PETROL", "HIGH"],
      [/\bV6\b/i, "3.5 V6 PETROL", "PETROL", "HIGH"],
    ],
  },
  ISUZU: {
    "D-MAX": [
      [/\b3\.0\s*L?\b/i, "3.0 DIESEL", "DIESEL", "HIGH"],
      [/\b1\.9\s*L?\b/i, "1.9 DIESEL", "DIESEL", "HIGH"],
    ],
    "MU-X": [
      [/\b3\.0\s*L?\b/i, "3.0 DIESEL", "DIESEL", "HIGH"],
      [/\b1\.9\s*L?\b/i, "1.9 DIESEL", "DIESEL", "HIGH"],
    ],
  },
  NISSAN: {
    PATROL: [
      [/\b5\.6\b/, "5.6 V8 PETROL", "PETROL", "HIGH"],
      [/\bV8\b/i, "5.6 V8 PETROL", "PETROL", "HIGH"],
    ],
    NAVARA: [
      [/\b2\.3\b/, "2.3 DIESEL", "DIESEL", "HIGH"],
      [/\bTWIN[\s-]?TURBO\b/i, "2.3 TWIN TURBO DIESEL", "DIESEL", "HIGH"],
    ],
  },
  MITSUBISHI: {
    TRITON: [
      [/\b2\.4\s*L?\b/i, "2.4 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.5\s*L?\b/i, "2.5 DIESEL", "DIESEL", "HIGH"],
    ],
    OUTLANDER: [
      [/\bPHEV\b/i, "PHEV", "HYBRID", "HIGH"],
      [/\bHYBRID\b/i, "PHEV", "HYBRID", "HIGH"],
      [/\b2\.5\b/, "2.5 PETROL", "PETROL", "MEDIUM"],
      [/\b2\.4\b/, "2.4 PETROL", "PETROL", "MEDIUM"],
    ],
  },
  VOLKSWAGEN: {
    AMAROK: [
      [/\bTDI580\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bTDI550\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bTDI420\b/i, "2.0 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.0\s*L?\s*V6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\bV6\b/i, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.0\b/, "3.0 V6 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.0\b/, "2.0 DIESEL", "DIESEL", "MEDIUM"],
    ],
  },
  MAZDA: {
    "BT-50": [
      [/\b3\.0\s*L?\b/i, "3.0 DIESEL", "DIESEL", "HIGH"],
      [/\b1\.9\s*L?\b/i, "1.9 DIESEL", "DIESEL", "HIGH"],
    ],
  },
  HYUNDAI: {
    "SANTA FE": [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.2\b/, "2.2 DIESEL", "DIESEL", "HIGH"],
      [/\b2\.5\b/, "2.5 PETROL", "PETROL", "MEDIUM"],
    ],
    TUCSON: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.0\b/, "2.0 DIESEL", "DIESEL", "MEDIUM"],
      [/\b1\.6\b/, "1.6 TURBO PETROL", "PETROL", "HIGH"],
    ],
  },
  KIA: {
    SORENTO: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.2\b/, "2.2 DIESEL", "DIESEL", "HIGH"],
      [/\b3\.5\b/, "3.5 V6 PETROL", "PETROL", "HIGH"],
      [/\bV6\b/i, "3.5 V6 PETROL", "PETROL", "HIGH"],
    ],
    SPORTAGE: [
      [/\bHYBRID\b/i, "HYBRID", "HYBRID", "HIGH"],
      [/\b2\.0\b/, "2.0 DIESEL", "DIESEL", "MEDIUM"],
      [/\b1\.6\b/, "1.6 TURBO PETROL", "PETROL", "HIGH"],
    ],
  },
};

// ─── Generic fallback patterns (any make/model) ──────────────────────────────
const GENERIC_RULES: EngineRule[] = [
  [/\b(\d\.\d)\s*L?\s*V8\b/i, "V8", null, "MEDIUM"],
  [/\bV8\b/i, "V8", null, "MEDIUM"],
  [/\b(\d\.\d)\s*L?\s*V6\b/i, "V6", null, "MEDIUM"],
  [/\bV6\b/i, "V6", null, "MEDIUM"],
  [/\bTWIN[\s-]?TURBO\b/i, "TWIN TURBO", null, "MEDIUM"],
  [/\bBI[\s-]?TURBO\b/i, "BITURBO", null, "MEDIUM"],
  [/\bBITURBO\b/i, "BITURBO", null, "MEDIUM"],
  [/\bTURBO\s*DIESEL\b/i, "TURBO DIESEL", "DIESEL", "MEDIUM"],
  [/\bECOBOOST\b/i, "ECOBOOST", "PETROL", "MEDIUM"],
  [/\bHYBRID\b/i, "HYBRID", "HYBRID", "MEDIUM"],
  [/\bPHEV\b/i, "PHEV", "HYBRID", "MEDIUM"],
  [/\bELECTRIC\b/i, "ELECTRIC", "ELECTRIC", "MEDIUM"],
  [/\bBEV\b/i, "ELECTRIC", "ELECTRIC", "MEDIUM"],
];

/**
 * Extract engine_type from free text.
 *
 * @param make     - Vehicle make (e.g. "Ford")
 * @param model    - Vehicle model (e.g. "Ranger")
 * @param texts    - Array of text fields to search (title, variant_raw, etc.)
 * @returns EngineExtraction with engine_type, confidence, and optional fuel hint
 */
export function extractEngine(
  make: string | null | undefined,
  model: string | null | undefined,
  ...texts: (string | null | undefined)[]
): EngineExtraction {
  const combined = texts.filter(Boolean).join(" ").toUpperCase();
  if (!combined.trim()) {
    return { engine_type: null, engine_confidence: "LOW", fuel_type_hint: null };
  }

  const makeUpper = (make || "").toUpperCase().trim();
  const modelUpper = (model || "").toUpperCase().trim();

  // Layer 1: Model-specific rules
  const modelRules = MODEL_RULES[makeUpper]?.[modelUpper];
  if (modelRules) {
    for (const [pattern, engineType, fuelHint, confidence] of modelRules) {
      if (pattern.test(combined)) {
        return {
          engine_type: engineType,
          engine_confidence: confidence,
          fuel_type_hint: fuelHint,
        };
      }
    }
  }

  // Layer 2: Generic fallback
  for (const [pattern, engineType, fuelHint, confidence] of GENERIC_RULES) {
    if (pattern.test(combined)) {
      return {
        engine_type: engineType,
        engine_confidence: confidence,
        fuel_type_hint: fuelHint,
      };
    }
  }

  return { engine_type: null, engine_confidence: "LOW", fuel_type_hint: null };
}
