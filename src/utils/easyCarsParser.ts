/**
 * EasyCars StockSoldReport PDF Parser
 * Parses vehicle sales data from EasyCars/Jeal format reports
 */

export interface ParsedVehicleSale {
  stock_no: string;
  deal_no: string;
  rego: string;
  make: string;
  model: string;
  year: number;
  variant: string;
  body_type: string;
  transmission: string;
  drivetrain: string;
  engine: string;
  sale_date: string;
  days_in_stock: number;
  sold_to: string;
  sell_price: number;
  total_cost: number;
  gross_profit: number;
  description_raw: string;
}

// Common Australian vehicle makes for matching
const KNOWN_MAKES = [
  'Audi', 'BMW', 'Chery', 'Chevrolet', 'Chrysler', 'Citroen', 'Dodge', 'Fiat',
  'Ford', 'Holden', 'Honda', 'Hyundai', 'Infiniti', 'Isuzu', 'Jaguar', 'Jeep',
  'Kia', 'Land Rover', 'Lexus', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi',
  'Nissan', 'Peugeot', 'Porsche', 'Renault', 'Skoda', 'Subaru', 'Suzuki',
  'Tesla', 'Toyota', 'Volkswagen', 'Volvo', 'RAM', 'LDV', 'GWM', 'Haval',
  'MG', 'Genesis', 'Alfa Romeo', 'Aston Martin', 'Bentley', 'Ferrari',
  'Lamborghini', 'Maserati', 'McLaren', 'Rolls-Royce', 'Great Wall',
  'SKODA', 'Rembrandt Caravans'
];

// Body type extraction patterns
const BODY_TYPES = [
  'Sedan', 'Hatchback', 'Wagon', 'Utility', 'Cab Chassis', 'Ute', 'SUV',
  'Coupe', 'Convertible', 'Van', 'Bus', 'Fastback', 'Hatch'
];

// Transmission patterns
const TRANSMISSION_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bMan\s*\d+sp\b/i, value: 'Manual' },
  { pattern: /\bAuto\s*\d+sp\b/i, value: 'Automatic' },
  { pattern: /\bSpts\s*Auto\b/i, value: 'Automatic' },
  { pattern: /\bDSG\b/i, value: 'Automatic' },
  { pattern: /\bCVT\b/i, value: 'CVT' },
  { pattern: /\bX-tronic\b/i, value: 'CVT' },
  { pattern: /\bS-CVT\b/i, value: 'CVT' },
  { pattern: /\bLineartronic\b/i, value: 'CVT' },
  { pattern: /\bTiptronic\b/i, value: 'Automatic' },
  { pattern: /\bmultitronic\b/i, value: 'CVT' },
  { pattern: /\bSteptronic\b/i, value: 'Automatic' },
  { pattern: /\bSelectShift\b/i, value: 'Automatic' },
  { pattern: /\bSPEEDSHIFT\b/i, value: 'Automatic' },
  { pattern: /\bRev-Tronic\b/i, value: 'Automatic' },
  { pattern: /\bD-CT\b/i, value: 'Automatic' },
  { pattern: /\bEDC\b/i, value: 'Automatic' },
  { pattern: /\bSKYACTIV-MT\b/i, value: 'Manual' },
  { pattern: /\bSKYACTIV-Drive\b/i, value: 'Automatic' },
];

// Drivetrain patterns
const DRIVETRAIN_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b4x4\b/i, value: '4x4' },
  { pattern: /\b4WD\b/i, value: '4WD' },
  { pattern: /\bAWD\b/i, value: 'AWD' },
  { pattern: /\b4MATIC\b/i, value: 'AWD' },
  { pattern: /\bquattro\b/i, value: 'AWD' },
  { pattern: /\bxDrive\b/i, value: 'AWD' },
  { pattern: /\b4x2\b/i, value: '4x2' },
  { pattern: /\b2WD\b/i, value: '2WD' },
  { pattern: /\bRWD\b/i, value: 'RWD' },
  { pattern: /\bFWD\b/i, value: 'FWD' },
];

// Engine extraction (e.g., "2.0DT", "3.5i", "5.0i", "2.4DT", "3.3DTT")
function extractEngine(description: string): string {
  const engineMatch = description.match(/\b(\d+\.\d+)(DT{1,2}|D|T|i|SC|kW)?\b/i);
  if (engineMatch) {
    const [, displacement, suffix] = engineMatch;
    const suffixLower = (suffix || 'i').toLowerCase();
    if (suffixLower.includes('dt')) return `${displacement}L Diesel Turbo`;
    if (suffixLower === 'd') return `${displacement}L Diesel`;
    if (suffixLower === 't') return `${displacement}L Turbo`;
    return `${displacement}L`;
  }
  // Check for hybrid
  if (/Hybrid/i.test(description)) return 'Hybrid';
  if (/Electric/i.test(description) || /EV\b/i.test(description)) return 'Electric';
  return '';
}

// Parse the EasyCars description format
// Example: "Toyota Landcruiser 2024 FJA300R GX Wagon 5dr Spts Auto 10sp 4x4 3.3DTT"
function parseDescription(description: string): {
  make: string;
  model: string;
  year: number;
  variant: string;
  body_type: string;
  transmission: string;
  drivetrain: string;
  engine: string;
} {
  let make = '';
  let model = '';
  let year = 0;
  let variant = '';
  let body_type = '';
  let transmission = '';
  let drivetrain = '';

  // Find the make (first known make in description)
  for (const knownMake of KNOWN_MAKES) {
    if (description.startsWith(knownMake + ' ')) {
      make = knownMake;
      description = description.slice(make.length).trim();
      break;
    }
  }

  // Extract year (4-digit number between 1990-2030)
  const yearMatch = description.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  // Extract model (text between make and year)
  if (make && year) {
    const modelMatch = description.match(new RegExp(`^(.+?)\\s+${year}`));
    if (modelMatch) {
      model = modelMatch[1].trim();
    }
  }

  // Extract body type
  for (const bodyType of BODY_TYPES) {
    if (description.includes(bodyType)) {
      body_type = bodyType;
      break;
    }
  }

  // Extract transmission
  for (const { pattern, value } of TRANSMISSION_PATTERNS) {
    if (pattern.test(description)) {
      transmission = value;
      break;
    }
  }

  // Extract drivetrain
  for (const { pattern, value } of DRIVETRAIN_PATTERNS) {
    if (pattern.test(description)) {
      drivetrain = value;
      break;
    }
  }

  // Extract variant - typically the code after year (e.g., FJA300R, GDJ150R) and trim level
  const variantMatch = description.match(new RegExp(`${year}\\s+([A-Z0-9]+\\s+)?([A-Z0-9-]+)\\s+`));
  if (variantMatch) {
    // Look for common trim levels
    const trimPatterns = ['GXL', 'GX', 'GR Sport', 'SR5', 'SR', 'Rugged X', 'Rugged', 'Sahara', 
      'VX', 'Kakadu', 'Workmate', 'Wildtrak', 'XLT', 'XL', 'XLS', 'ST-X', 'ST-L', 'ST', 'SL', 'Ti', 
      'Elite', 'Akera', 'Maxx', 'Neo', 'GLX+', 'GLX', 'GL', 'LS-U', 'LS-T', 'LS-M', 'LS', 
      'Laredo', 'Limited', 'Overland', 'Trailhawk', 'SRT', 'AMG', 'R-Dynamic', 'HSE', 'SE',
      'Premium Pack', 'Aspire', 'Active', 'Sport', 'Luxury', 'Premium'];
    
    for (const trim of trimPatterns) {
      if (description.includes(trim)) {
        variant = trim;
        break;
      }
    }
  }

  const engine = extractEngine(description);

  return { make, model, year, variant, body_type, transmission, drivetrain, engine };
}

// Parse money string to number (e.g., "$1,800.00" -> 1800)
function parseMoney(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Parse date string (DD/MM/YY -> YYYY-MM-DD)
function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return dateStr;
  
  let [, day, month, year] = match;
  // Handle 2-digit year
  if (year.length === 2) {
    const numYear = parseInt(year, 10);
    year = numYear > 50 ? `19${year}` : `20${year}`;
  }
  
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Parse a single table row from the markdown
function parseTableRow(row: string): string[] {
  return row.split('|').map(cell => cell.trim()).filter(Boolean);
}

/**
 * Parse markdown content from EasyCars StockSoldReport PDF
 */
export function parseEasyCarsReport(markdownContent: string): ParsedVehicleSale[] {
  const sales: ParsedVehicleSale[] = [];
  const lines = markdownContent.split('\n');
  
  let currentRow: Partial<ParsedVehicleSale> | null = null;
  let descriptionContinuation = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip non-data lines
    if (!line.includes('|')) continue;
    if (line.includes('Stock No') || line.includes('Deal No') || line.includes('---')) continue;
    if (line.includes('TOTAL') || line.includes('AVERAGES') || line.includes('Summary')) continue;
    if (line.includes('Printed using')) continue;
    
    const cells = parseTableRow(line);
    if (cells.length < 5) continue;
    
    // Check if this is a primary row (starts with stock number) or continuation
    const isNumericFirst = /^\d+$/.test(cells[0]);
    
    if (isNumericFirst && cells.length >= 8) {
      // Save previous row if exists
      if (currentRow && currentRow.description_raw) {
        const parsed = parseDescription(currentRow.description_raw);
        const sale: ParsedVehicleSale = {
          stock_no: currentRow.stock_no || '',
          deal_no: currentRow.deal_no || '',
          rego: currentRow.rego || '',
          make: parsed.make,
          model: parsed.model,
          year: parsed.year,
          variant: parsed.variant,
          body_type: parsed.body_type,
          transmission: parsed.transmission,
          drivetrain: parsed.drivetrain,
          engine: parsed.engine,
          sale_date: currentRow.sale_date || '',
          days_in_stock: currentRow.days_in_stock || 0,
          sold_to: currentRow.sold_to || '',
          sell_price: currentRow.sell_price || 0,
          total_cost: currentRow.total_cost || 0,
          gross_profit: currentRow.gross_profit || 0,
          description_raw: currentRow.description_raw,
        };
        if (sale.make && sale.year) {
          sales.push(sale);
        }
      }
      
      // Start new row - handle variable column positions
      // Format varies: Stock No | Deal No | Rego | Description | Sale Date | Days | Sold to | Selling Price | Net Over | Total Cost | GST | Profit
      currentRow = {
        stock_no: cells[0],
        deal_no: cells[1],
        rego: cells[2] || '',
        description_raw: cells[3] || '',
        sale_date: parseDate(cells[4] || ''),
        days_in_stock: parseInt(cells[5], 10) || 0,
        sold_to: cells[6] || '',
        sell_price: parseMoney(cells[7] || ''),
        // Total cost is typically at index 9, profit at last
        total_cost: parseMoney(cells[9] || cells[8] || ''),
        gross_profit: parseMoney(cells[cells.length - 1] || ''),
      };
    } else if (currentRow && !isNumericFirst) {
      // This is a continuation line (description continues)
      // Find the description part and append
      const continuedDesc = cells.find(c => c.length > 10 && !c.includes('$'));
      if (continuedDesc) {
        currentRow.description_raw = (currentRow.description_raw || '') + ' ' + continuedDesc;
      }
      // Also check for sold_to continuation
      const soldToCont = cells.find(c => c.length > 10 && !c.includes('$') && c !== continuedDesc);
      if (soldToCont && !currentRow.sold_to?.includes(soldToCont)) {
        currentRow.sold_to = (currentRow.sold_to || '') + ' ' + soldToCont;
      }
    }
  }
  
  // Don't forget the last row
  if (currentRow && currentRow.description_raw) {
    const parsed = parseDescription(currentRow.description_raw);
    const sale: ParsedVehicleSale = {
      stock_no: currentRow.stock_no || '',
      deal_no: currentRow.deal_no || '',
      rego: currentRow.rego || '',
      make: parsed.make,
      model: parsed.model,
      year: parsed.year,
      variant: parsed.variant,
      body_type: parsed.body_type,
      transmission: parsed.transmission,
      drivetrain: parsed.drivetrain,
      engine: parsed.engine,
      sale_date: currentRow.sale_date || '',
      days_in_stock: currentRow.days_in_stock || 0,
      sold_to: currentRow.sold_to || '',
      sell_price: currentRow.sell_price || 0,
      total_cost: currentRow.total_cost || 0,
      gross_profit: currentRow.gross_profit || 0,
      description_raw: currentRow.description_raw,
    };
    if (sale.make && sale.year) {
      sales.push(sale);
    }
  }
  
  return sales;
}

/**
 * Convert parsed sales to Dealer_Sales_History format
 */
export interface DealerSalesHistoryRecord {
  record_id: string;
  source: string;
  dealer_name: string;
  imported_at: string;
  stock_no: string;
  rego: string;
  make: string;
  model: string;
  year: number;
  variant: string;
  body_type: string;
  transmission: string;
  drivetrain: string;
  engine: string;
  sale_date: string;
  days_in_stock: number;
  sell_price: number;
  total_cost: number;
  gross_profit: number;
  description_raw: string;
}

export function toSalesHistoryRecords(
  sales: ParsedVehicleSale[],
  dealerName: string,
  source: string = 'EasyCars PDF'
): DealerSalesHistoryRecord[] {
  const importedAt = new Date().toISOString();
  
  return sales.map((sale, idx) => ({
    record_id: `${dealerName.replace(/\s+/g, '_')}_${sale.stock_no}_${Date.now()}`,
    source,
    dealer_name: dealerName,
    imported_at: importedAt,
    stock_no: sale.stock_no,
    rego: sale.rego,
    make: sale.make,
    model: sale.model,
    year: sale.year,
    variant: sale.variant,
    body_type: sale.body_type,
    transmission: sale.transmission,
    drivetrain: sale.drivetrain,
    engine: sale.engine,
    sale_date: sale.sale_date,
    days_in_stock: sale.days_in_stock,
    sell_price: sale.sell_price,
    total_cost: sale.total_cost,
    gross_profit: sale.gross_profit,
    description_raw: sale.description_raw,
  }));
}
