import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

// Base64 URL encoding helper
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate JWT for Google API authentication
async function createJWT(serviceAccount: ServiceAccountKey): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Import private key for signing
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  let pemContents = serviceAccount.private_key;
  // Handle escaped newlines from environment variable storage
  pemContents = pemContents.replace(/\\n/g, '\n');
  pemContents = pemContents.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signatureInput)
  );

  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

// Get access token from Google
async function getAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const jwt = await createJWT(serviceAccount);
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token error:', error);
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Default headers for auto-created sheets
const SHEET_HEADERS: Record<string, string[]> = {
  'Sales_Imports_Raw': [
    'import_id', 'uploaded_at', 'dealer_name', 'source', 'original_row_json', 'parse_status', 'parse_notes'
  ],
  'Sales_Normalised': [
    'sale_id', 'import_id', 'dealer_name', 'sale_date', 'make', 'model', 'variant_raw', 'variant_normalised',
    'sale_price', 'days_to_sell', 'location', 'km', 'quality_flag', 'notes', 'year', 'engine', 'drivetrain',
    'transmission', 'fingerprint_generated', 'fingerprint_id', 'gross_profit', 'activate', 'do_not_replicate', 'tags',
    'do_not_buy', 'do_not_buy_reason'
  ],
  'Sale_Fingerprints': [
    'fingerprint_id', 'dealer_name', 'dealer_whatsapp', 'sale_date', 'expires_at', 'make', 'model', 
    'variant_normalised', 'variant_family', 'year', 'sale_km', 'min_km', 'max_km', 'engine', 'drivetrain', 'transmission', 
    'shared_opt_in', 'is_active', 'fingerprint_type', 'source_sale_id', 'source_import_id',
    'do_not_buy', 'do_not_buy_reason'
  ],
  'Fingerprint_Sync_Log': [
    'synclog_id', 'run_at', 'mode', 'rows_scanned', 'rows_eligible', 'rows_created', 'rows_updated', 
    'rows_skipped', 'skip_reason_counts', 'errors'
  ],
  // Canonical Listings table (renamed from Auction_Lots)
  'Listings': [
    // Identity
    'listing_id', 'lot_key', 'lot_id', 'listing_key',
    // Source
    'source', 'source_site', 'source_type', 'source_name',
    // Event/Location
    'event_id', 'auction_house', 'location', 'auction_datetime', 'listing_url',
    // Variant family for tier-2 matching
    'variant_family',
    // Vehicle
    'make', 'model', 'variant_raw', 'variant_normalised', 'year', 'km', 'fuel', 'drivetrain', 'transmission',
    // Pricing
    'reserve', 'highest_bid', 'first_seen_price', 'last_seen_price', 'price_current', 'price_prev', 'price_change_pct',
    // Lifecycle
    'status', 'pass_count', 'price_drop_count', 'relist_count',
    'first_seen_at', 'last_seen_at', 'last_auction_date', 'days_listed',
    // Scoring
    'description_score', 'estimated_get_out', 'estimated_margin', 'confidence_score', 'action', 'visible_to_dealers',
    // Tracking
    'updated_at', 'last_status', 'relist_group_id',
    // Override
    'manual_confidence_score', 'manual_action', 'override_enabled',
    // Data quality
    'invalid_source',
    // Exclusion (condition risk)
    'excluded_reason', 'excluded_keyword'
  ],
  // Saved Searches - admin-managed search URLs for automated ingestion
  'Saved_Searches': [
    'search_id', 'source_site', 'label', 'search_url', 'refresh_frequency_hours', 
    'max_pages', 'enabled', 'last_run_at', 'notes', 'created_at',
    // Run diagnostics
    'last_run_status', 'last_http_status', 'last_listings_found', 
    'last_listings_upserted', 'last_error_message'
  ],
};

// Read data from a sheet (auto-creates if missing, adds headers if empty)
async function readSheet(accessToken: string, spreadsheetId: string, sheetName: string): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Check if sheet doesn't exist (400 error with "Unable to parse range")
    if (response.status === 400 && errorText.includes('Unable to parse range')) {
      console.log(`Sheet ${sheetName} not found, attempting to create...`);
      const headers = SHEET_HEADERS[sheetName];
      if (headers) {
        try {
          await createSheet(accessToken, spreadsheetId, sheetName, headers);
          console.log(`Created sheet ${sheetName} with default headers`);
          return [headers]; // Return just headers for empty sheet
        } catch (createError: any) {
          // Sheet might already exist but be empty - try adding headers only
          if (createError.message?.includes('already exists')) {
            console.log(`Sheet ${sheetName} exists but may be empty, adding headers...`);
            await addHeadersToSheet(accessToken, spreadsheetId, sheetName, headers);
            return [headers];
          }
          throw createError;
        }
      }
    }
    console.error(`Read error for ${sheetName}:`, errorText);
    throw new Error(`Failed to read sheet ${sheetName}: ${errorText}`);
  }

  const data = await response.json();
  const values = data.values || [];
  
  // If sheet exists but is empty or has no headers, add default headers
  if (values.length === 0) {
    const headers = SHEET_HEADERS[sheetName];
    if (headers) {
      console.log(`Sheet ${sheetName} is empty, adding default headers...`);
      await addHeadersToSheet(accessToken, spreadsheetId, sheetName, headers);
      return [headers];
    }
  }
  
  // Check for malformed headers (pipe-separated in a single cell)
  const expectedHeaders = SHEET_HEADERS[sheetName];
  if (expectedHeaders && values.length > 0 && values[0].length === 1 && values[0][0]?.includes('|')) {
    console.log(`Sheet ${sheetName} has malformed pipe-separated headers, fixing...`);
    await addHeadersToSheet(accessToken, spreadsheetId, sheetName, expectedHeaders);
    // If there's no data beyond headers, return just the fixed headers
    if (values.length === 1) {
      return [expectedHeaders];
    }
    // Otherwise, return fixed headers + existing data
    values[0] = expectedHeaders;
  }
  
  return values;
}

// Add headers to an existing empty sheet
async function addHeadersToSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[]
): Promise<void> {
  const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=USER_ENTERED`;
  
  const headerResponse = await fetch(headerUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [headers] }),
  });

  if (!headerResponse.ok) {
    const error = await headerResponse.text();
    console.error(`Header write error for ${sheetName}:`, error);
    throw new Error(`Failed to write headers to ${sheetName}: ${error}`);
  }
  console.log(`Added headers to ${sheetName}: ${headers.join(', ')}`);
}

// Write/append data to a sheet
async function appendToSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  values: any[][]
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Append error for ${sheetName}:`, error);
    throw new Error(`Failed to append to sheet ${sheetName}: ${error}`);
  }
}

// Update a specific row in a sheet
async function updateRow(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  values: any[]
): Promise<void> {
  const range = `${sheetName}!A${rowIndex + 1}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Update error for ${sheetName}:`, error);
    throw new Error(`Failed to update row in ${sheetName}: ${error}`);
  }
}

// Create a new sheet with headers
async function createSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[]
): Promise<void> {
  // First, add the new sheet
  const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  
  const addSheetResponse = await fetch(batchUpdateUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        addSheet: {
          properties: { title: sheetName }
        }
      }]
    }),
  });

  if (!addSheetResponse.ok) {
    const error = await addSheetResponse.text();
    console.error(`Create sheet error for ${sheetName}:`, error);
    throw new Error(`Failed to create sheet ${sheetName}: ${error}`);
  }

  // Then add the headers
  const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=USER_ENTERED`;
  
  const headerResponse = await fetch(headerUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [headers] }),
  });

  if (!headerResponse.ok) {
    const error = await headerResponse.text();
    console.error(`Header write error for ${sheetName}:`, error);
    throw new Error(`Failed to write headers to ${sheetName}: ${error}`);
  }
}

// Convert sheet rows to objects using headers
function rowsToObjects(rows: any[][]): any[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row, index) => {
    const obj: any = { _rowIndex: index + 1 }; // Track row index for updates
    headers.forEach((header: string, i: number) => {
      obj[header] = row[i] ?? '';
    });
    return obj;
  });
}

// Convert object to row values based on headers
function objectToRow(obj: any, headers: string[]): any[] {
  return headers.map(header => obj[header] ?? '');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceAccountKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    let spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID');

    if (!serviceAccountKey || !spreadsheetId) {
      console.error('Missing environment variables');
      return new Response(
        JSON.stringify({ error: 'Missing configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract spreadsheet ID from URL if full URL was provided
    // Handles: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
    // Also handles if user pasted ID with trailing path like: ID/edit?gid=0
    const urlMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      spreadsheetId = urlMatch[1];
      console.log('Extracted spreadsheet ID from URL:', spreadsheetId);
    } else {
      // Clean up any trailing path segments (e.g., /edit?gid=0)
      spreadsheetId = spreadsheetId.split('/')[0].split('?')[0];
      console.log('Using cleaned spreadsheet ID:', spreadsheetId);
    }

    console.log('Raw key length:', serviceAccountKey.length);
    
    const serviceAccount: ServiceAccountKey = JSON.parse(serviceAccountKey);
    console.log('Client email:', serviceAccount.client_email);
    
    const accessToken = await getAccessToken(serviceAccount);
    
    const { action, sheet, data, rowIndex } = await req.json();
    console.log(`Processing action: ${action} for sheet: ${sheet}`);

    switch (action) {
      case 'read': {
        const rows = await readSheet(accessToken, spreadsheetId, sheet);
        const objects = rowsToObjects(rows);
        console.log(`Read ${objects.length} rows from ${sheet}`);
        return new Response(
          JSON.stringify({ success: true, data: objects, headers: rows[0] || [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'append': {
        // First read headers
        const existingRows = await readSheet(accessToken, spreadsheetId, sheet);
        const headers = existingRows[0] || Object.keys(data);
        const rowValues = objectToRow(data, headers);
        await appendToSheet(accessToken, spreadsheetId, sheet, [rowValues]);
        console.log(`Appended row to ${sheet}`);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'batch_append': {
        // Batch append multiple rows in a single API call (avoids rate limits)
        const existingRows = await readSheet(accessToken, spreadsheetId, sheet);
        const headers = existingRows[0] || (data.length > 0 ? Object.keys(data[0]) : []);
        
        // Convert all objects to row arrays
        const allRowValues = data.map((item: any) => objectToRow(item, headers));
        
        await appendToSheet(accessToken, spreadsheetId, sheet, allRowValues);
        console.log(`Batch appended ${data.length} rows to ${sheet}`);
        return new Response(
          JSON.stringify({ success: true, count: data.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        // First read headers
        const existingRows = await readSheet(accessToken, spreadsheetId, sheet);
        const headers = existingRows[0] || [];
        const rowValues = objectToRow(data, headers);
        await updateRow(accessToken, spreadsheetId, sheet, rowIndex, rowValues);
        console.log(`Updated row ${rowIndex} in ${sheet}`);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create': {
        const headers = data.headers || [];
        await createSheet(accessToken, spreadsheetId, sheet, headers);
        console.log(`Created sheet ${sheet} with headers: ${headers.join(', ')}`);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reset_headers': {
        // Replace the first row (headers) in an existing sheet
        const headers = data.headers || [];
        const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!A1?valueInputOption=USER_ENTERED`;
        
        const headerResponse = await fetch(headerUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [headers] }),
        });

        if (!headerResponse.ok) {
          const error = await headerResponse.text();
          throw new Error(`Failed to reset headers: ${error}`);
        }
        
        console.log(`Reset headers for ${sheet}: ${headers.join(', ')}`);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
