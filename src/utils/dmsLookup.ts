// DMS Make/Model ID to Text Lookup
// Common DMS systems export make_id/model_id as numeric values
// This utility resolves them to text labels

// Common make IDs from various DMS systems
const MAKE_ID_LOOKUP: Record<string, string> = {
  // EasyCars / AutoTrader common IDs (example mappings)
  '2438': 'Toyota',
  '2439': 'Ford',
  '2440': 'Mazda',
  '2441': 'Holden',
  '2442': 'Nissan',
  '2443': 'Honda',
  '2444': 'Hyundai',
  '2445': 'Kia',
  '2446': 'Mitsubishi',
  '2447': 'Subaru',
  '2448': 'Volkswagen',
  '2449': 'BMW',
  '2450': 'Mercedes-Benz',
  '2451': 'Audi',
  '2452': 'Lexus',
  '2453': 'Isuzu',
  '2454': 'Jeep',
  '2455': 'Land Rover',
  '2456': 'Porsche',
  '2457': 'Volvo',
  '2458': 'Tesla',
  '2459': 'Suzuki',
  '2460': 'Peugeot',
  '2461': 'Renault',
  '2462': 'Skoda',
  '2463': 'Chrysler',
  '2464': 'Dodge',
  '2465': 'Fiat',
  '2466': 'Alfa Romeo',
  '2467': 'Mini',
  '2468': 'Citroen',
  '2469': 'LDV',
  '2470': 'Great Wall',
  '2471': 'Haval',
  '2472': 'MG',
  '2473': 'GWM',
  '2474': 'BYD',
  '2475': 'Chery',
  '2476': 'Geely',
  '2477': 'JAC',
  // More common variations
  '1': 'Toyota',
  '2': 'Ford',
  '3': 'Holden',
  '4': 'Mazda',
  '5': 'Nissan',
  '6': 'Honda',
  '7': 'Hyundai',
  '8': 'Kia',
  '9': 'Mitsubishi',
  '10': 'Subaru',
  '11': 'Volkswagen',
  '12': 'BMW',
  '13': 'Mercedes-Benz',
  '14': 'Audi',
  '15': 'Lexus',
  '16': 'Isuzu',
  '17': 'Jeep',
  '18': 'Land Rover',
  '19': 'Porsche',
  '20': 'Volvo',
};

// Model IDs are typically make-specific, so we use composite keys
// Format: make:model_id or just common standalone IDs
const MODEL_ID_LOOKUP: Record<string, string> = {
  // Toyota models
  'Toyota:1': 'Hilux',
  'Toyota:2': 'Landcruiser',
  'Toyota:3': 'Camry',
  'Toyota:4': 'Corolla',
  'Toyota:5': 'RAV4',
  'Toyota:6': 'Prado',
  'Toyota:7': 'Kluger',
  'Toyota:8': 'Fortuner',
  'Toyota:9': 'Yaris',
  'Toyota:10': 'C-HR',
  'Toyota:11': '86',
  'Toyota:12': 'Supra',
  'Toyota:13': 'HiAce',
  
  // Ford models
  'Ford:1': 'Ranger',
  'Ford:2': 'Mustang',
  'Ford:3': 'Everest',
  'Ford:4': 'Focus',
  'Ford:5': 'Fiesta',
  'Ford:6': 'Escape',
  'Ford:7': 'Endura',
  'Ford:8': 'Transit',
  'Ford:9': 'Bronco',
  'Ford:10': 'Puma',
  
  // Mazda models
  'Mazda:1': 'CX-5',
  'Mazda:2': 'CX-3',
  'Mazda:3': 'CX-9',
  'Mazda:4': 'BT-50',
  'Mazda:5': 'Mazda3',
  'Mazda:6': 'Mazda2',
  'Mazda:7': 'MX-5',
  'Mazda:8': 'CX-30',
  'Mazda:9': 'CX-8',
  'Mazda:10': 'Mazda6',
  
  // Nissan models
  'Nissan:1': 'Navara',
  'Nissan:2': 'Patrol',
  'Nissan:3': 'X-Trail',
  'Nissan:4': 'Qashqai',
  'Nissan:5': 'Pathfinder',
  'Nissan:6': 'Juke',
  'Nissan:7': 'Leaf',
  'Nissan:8': '370Z',
  
  // Volkswagen models
  'Volkswagen:1': 'Amarok',
  'Volkswagen:2': 'Golf',
  'Volkswagen:3': 'Tiguan',
  'Volkswagen:4': 'Polo',
  'Volkswagen:5': 'Passat',
  'Volkswagen:6': 'T-Cross',
  'Volkswagen:7': 'Touareg',
  'Volkswagen:8': 'Transporter',
  'Volkswagen:9': 'Crafter',
  
  // Hyundai models
  'Hyundai:1': 'i30',
  'Hyundai:2': 'Tucson',
  'Hyundai:3': 'Santa Fe',
  'Hyundai:4': 'Kona',
  'Hyundai:5': 'Palisade',
  'Hyundai:6': 'Venue',
  'Hyundai:7': 'Staria',
  'Hyundai:8': 'Ioniq',
  'Hyundai:9': 'i20',
  
  // Kia models
  'Kia:1': 'Sportage',
  'Kia:2': 'Sorento',
  'Kia:3': 'Cerato',
  'Kia:4': 'Carnival',
  'Kia:5': 'Seltos',
  'Kia:6': 'Stinger',
  'Kia:7': 'EV6',
  'Kia:8': 'Picanto',
  
  // Mitsubishi models
  'Mitsubishi:1': 'Triton',
  'Mitsubishi:2': 'Pajero',
  'Mitsubishi:3': 'Outlander',
  'Mitsubishi:4': 'ASX',
  'Mitsubishi:5': 'Eclipse Cross',
  'Mitsubishi:6': 'Pajero Sport',
  'Mitsubishi:7': 'Express',
  
  // Isuzu models
  'Isuzu:1': 'D-Max',
  'Isuzu:2': 'MU-X',
  'Isuzu:3': 'N-Series',
  'Isuzu:4': 'F-Series',
  
  // Standalone numeric model IDs (some DMS use these)
  '100': 'Hilux',
  '101': 'Ranger',
  '102': 'Landcruiser',
  '103': 'Navara',
  '104': 'Triton',
  '105': 'D-Max',
  '106': 'Amarok',
  '107': 'BT-50',
  '108': 'Colorado',
  '109': 'Patrol',
  '110': 'Prado',
  '200': 'Camry',
  '201': 'Corolla',
  '202': 'RAV4',
  '203': 'CX-5',
  '204': 'Tucson',
  '205': 'Sportage',
  '206': 'Outlander',
  '207': 'X-Trail',
};

/**
 * Check if a value looks like a numeric ID (e.g., "2438", "101")
 */
export function isNumericId(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  // Must be all digits and at least 1 character
  return /^\d+$/.test(trimmed);
}

/**
 * Resolve a numeric make ID to text label
 * Returns the original value if not found in lookup
 */
export function resolveMakeId(makeId: string): string {
  if (!makeId) return makeId;
  const trimmed = makeId.trim();
  
  // If it's not numeric, return as-is (already a text label)
  if (!isNumericId(trimmed)) {
    return trimmed;
  }
  
  return MAKE_ID_LOOKUP[trimmed] || trimmed;
}

/**
 * Resolve a numeric model ID to text label
 * Uses make context if available for better matching
 * Returns the original value if not found in lookup
 */
export function resolveModelId(modelId: string, make?: string): string {
  if (!modelId) return modelId;
  const trimmed = modelId.trim();
  
  // If it's not numeric, return as-is (already a text label)
  if (!isNumericId(trimmed)) {
    return trimmed;
  }
  
  // Try make-specific lookup first
  if (make) {
    const resolvedMake = resolveMakeId(make);
    const compositeKey = `${resolvedMake}:${trimmed}`;
    if (MODEL_ID_LOOKUP[compositeKey]) {
      return MODEL_ID_LOOKUP[compositeKey];
    }
  }
  
  // Fall back to standalone lookup
  return MODEL_ID_LOOKUP[trimmed] || trimmed;
}

/**
 * Normalize make and model fields
 * Detects numeric IDs and resolves them to text labels
 */
export function normalizeMakeModel(
  make: string,
  model: string
): { make: string; model: string; make_id?: string; model_id?: string } {
  const result: { make: string; model: string; make_id?: string; model_id?: string } = {
    make: make,
    model: model,
  };
  
  // Check if make is numeric
  if (isNumericId(make)) {
    result.make_id = make;
    result.make = resolveMakeId(make);
  }
  
  // Check if model is numeric
  if (isNumericId(model)) {
    result.model_id = model;
    result.model = resolveModelId(model, result.make);
  }
  
  return result;
}

/**
 * Check if normalization would change the values
 * (i.e., if either make or model is a numeric ID that can be resolved)
 */
export function needsNormalization(make: string, model: string): boolean {
  if (isNumericId(make) && MAKE_ID_LOOKUP[make.trim()]) {
    return true;
  }
  if (isNumericId(model)) {
    // Check standalone first
    if (MODEL_ID_LOOKUP[model.trim()]) {
      return true;
    }
    // Check make-specific
    const resolvedMake = resolveMakeId(make);
    const compositeKey = `${resolvedMake}:${model.trim()}`;
    if (MODEL_ID_LOOKUP[compositeKey]) {
      return true;
    }
  }
  return false;
}
