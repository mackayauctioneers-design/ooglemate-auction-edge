import { Listing, shouldExcludeListing } from '@/types';

interface ParsedLot {
  lot: Partial<Listing>;
  rawText: string;
}

/**
 * Parse Pickles catalogue content (from PDF/DOCX markdown output)
 * Handles multiple formats from the parsed document tables
 */
export function parsePicklesCatalogue(
  rawText: string,
  eventId: string,
  auctionDate: string
): ParsedLot[] {
  const lots: ParsedLot[] = [];
  const seenLots = new Set<string>();
  
  // Multiple patterns to match lot entries from various table formats:
  // Pattern 1: | 1   | CP:08/2015, Ford, Ranger, ...
  // Pattern 2: | 3 CP:12/2018 | Ford, Everest, ...
  // Pattern 3: | 32 CP: | 05/2018, Nissan, ...
  
  const patterns = [
    // Standard format: | lotNum | CP:MM/YYYY, Make, Model, ...
    /\|\s*(\d+)\s*\|\s*CP:\s*(\d{2}\/\d{4})\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
    // Merged format: | lotNum CP:MM/YYYY | Make, Model, ...
    /\|\s*(\d+)\s+CP:\s*(\d{2}\/\d{4})\s*\|\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
    // Split format: | lotNum CP: | MM/YYYY, Make, Model, ...
    /\|\s*(\d+)\s+CP:\s*\|\s*(\d{2}\/\d{4})\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
    // Alternative with make in lot cell: | lotNum CP:MM/YYYY,Make,Model | variant...
    /\|\s*(\d+)\s+CP:\s*(\d{2}\/\d{4})\s*,\s*([^,]+)\s*,\s*([^,|]+)\s*,\s*([^|]+)/gi,
  ];
  
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0; // Reset regex
    
    while ((match = pattern.exec(rawText)) !== null) {
      const lotNumber = match[1];
      
      // Skip if we've already parsed this lot
      if (seenLots.has(lotNumber)) continue;
      
      const compDate = match[2];
      const yearMatch = compDate.match(/\d{2}\/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      
      const make = match[3].trim();
      const model = match[4].trim();
      const remainingText = match[5] || '';
      
      // Extract variant (first comma-separated value after make/model)
      const parts = remainingText.split(',').map(p => p.trim());
      const variant_raw = parts[0] || '';
      
      // Parse additional fields from remaining text
      const fullDescription = remainingText;
      
      // Extract transmission
      let transmission = 'Auto'; // Default
      if (/manual/i.test(fullDescription)) transmission = 'Manual';
      else if (/cvt|constantly variable/i.test(fullDescription)) transmission = 'CVT';
      else if (/dct|dual clutch/i.test(fullDescription)) transmission = 'DCT';
      
      // Extract engine size
      let engine = '';
      const engineMatch = fullDescription.match(/(\d+\.?\d*)\s*Ltr/i);
      if (engineMatch) engine = `${engineMatch[1]}L`;
      
      // Extract fuel type
      let fuel = '';
      if (/diesel/i.test(fullDescription)) fuel = 'Diesel';
      else if (/petrol|unleaded/i.test(fullDescription)) fuel = 'Petrol';
      else if (/electric/i.test(fullDescription)) fuel = 'Electric';
      else if (/hybrid/i.test(fullDescription)) fuel = 'Hybrid';
      
      // Extract KM
      let km = 0;
      const kmMatch = fullDescription.match(/(\d[\d,]*)\s*\(Kms/i);
      if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      
      // Extract location (Australian state)
      let location = '';
      const locationMatch = fullDescription.match(/([A-Za-z\s]+),?\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i);
      if (locationMatch) {
        location = `${locationMatch[1].trim()}, ${locationMatch[2].toUpperCase()}`;
      }
      
      // Extract drivetrain
      let drivetrain = '';
      if (/\b4WD\b|four[- ]?wheel/i.test(fullDescription)) drivetrain = '4WD';
      else if (/\bAWD\b|all[- ]?wheel/i.test(fullDescription)) drivetrain = 'AWD';
      else if (/\bRWD\b|rear[- ]?wheel/i.test(fullDescription)) drivetrain = 'RWD';
      else if (/\bFWD\b|front[- ]?wheel/i.test(fullDescription)) drivetrain = 'FWD';
      
      const now = new Date().toISOString();
      const lot_key = `Pickles:${lotNumber}`;
      
      const lot: Partial<Listing> = {
        listing_id: lot_key,
        lot_id: lotNumber,
        lot_key,
        listing_key: lot_key,
        source: 'auction',
        source_site: 'Pickles',
        source_type: 'auction',
        source_name: 'Pickles Catalogue',
        event_id: eventId,
        auction_house: 'Pickles',
        location,
        auction_datetime: auctionDate,
        listing_url: '',
        make,
        model,
        variant_raw,
        variant_normalised: variant_raw,
        year,
        km,
        fuel,
        drivetrain,
        transmission,
        reserve: 0,
        highest_bid: 0,
        first_seen_price: 0,
        last_seen_price: 0,
        price_current: 0,
        price_prev: 0,
        price_change_pct: 0,
        status: 'listed',
        pass_count: 0,
        price_drop_count: 0,
        relist_count: 0,
        first_seen_at: now,
        last_seen_at: now,
        last_auction_date: auctionDate,
        days_listed: 0,
        description_score: 2,
        estimated_get_out: 0,
        estimated_margin: 0,
        confidence_score: 0,
        action: 'Watch',
        visible_to_dealers: 'Y',
        updated_at: now,
        last_status: 'listed',
        relist_group_id: '',
        override_enabled: 'N',
        invalid_source: 'N',
      };
      
      // Check for condition exclusions
      const exclusionCheck = shouldExcludeListing(lot, fullDescription);
      if (exclusionCheck.excluded) {
        lot.excluded_reason = 'condition_risk';
        lot.excluded_keyword = exclusionCheck.keyword;
        lot.visible_to_dealers = 'N';
      }
      
      seenLots.add(lotNumber);
      lots.push({ lot, rawText: match[0] });
    }
  }
  
  // Sort by lot number
  lots.sort((a, b) => parseInt(a.lot.lot_id || '0') - parseInt(b.lot.lot_id || '0'));
  
  return lots;
}

/**
 * Extract event info (ID and date) from catalogue header text
 */
export function extractEventInfo(text: string): { eventId: string; auctionDate: string } {
  // Try to find event ID like "12931" in the text
  const eventIdMatch = text.match(/Event\s*(?:ID)?[:\s]*(\d+)/i) || 
                       text.match(/Catalogue[_\-\s]*(\d+)/i) ||
                       text.match(/\b(\d{5})\b/); // 5-digit number as fallback
  
  // Try to find auction date in format like "2/1/2026 - 4/1/2026" or similar
  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  
  let auctionDate = new Date().toISOString().split('T')[0];
  if (dateMatch) {
    const parts = dateMatch[1].split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      auctionDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  return {
    eventId: eventIdMatch ? eventIdMatch[1] : '',
    auctionDate
  };
}
