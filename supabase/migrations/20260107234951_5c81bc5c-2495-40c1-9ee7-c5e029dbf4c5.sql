-- ===========================================================================
-- NSW DENSITY RAMP: Update region buckets to broader NSW zones
-- ===========================================================================

-- Update location_to_region function with NSW-focused buckets
CREATE OR REPLACE FUNCTION public.location_to_region(p_location text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  loc text;
BEGIN
  IF p_location IS NULL OR trim(p_location) = '' THEN
    RETURN 'UNKNOWN';
  END IF;
  
  loc := lower(trim(p_location));
  
  -- ==========================================================================
  -- NSW BUCKETS (priority order)
  -- ==========================================================================
  
  -- NSW_CENTRAL_COAST - Central Coast LGA
  IF loc ~ '(central coast|gosford|wyong|tuggerah|erina|terrigal|woy woy|umina|ettalong|kariong|kincumber|avoca|copacabana|bateau bay|the entrance|toukley|budgewoi|lake haven|berkeley vale|ourimbah|lisarow|niagara park|wyoming|narara|somersby|kulnura|wamberal|matcham|holgate|killarney vale|long jetty|san remo|charmhaven|buff point|gwandalan|summerland point|gorokan|kanwal|woongarrah|hamlyn terrace|wadalba|tacoma)' THEN
    RETURN 'NSW_CENTRAL_COAST';
  END IF;
  
  -- NSW_HUNTER_NEWCASTLE - Hunter/Newcastle region
  IF loc ~ '(newcastle|maitland|cessnock|singleton|muswellbrook|scone|hunter|lambton|hamilton|mayfield|charlestown|cardiff|kotara|warners bay|belmont|swansea|lake macquarie|raymond terrace|nelson bay|port stephens|kurri kurri|rutherford|thornton|beresfield)' THEN
    RETURN 'NSW_HUNTER_NEWCASTLE';
  END IF;
  
  -- NSW_SYDNEY_METRO - Greater Sydney
  IF loc ~ '(sydney|parramatta|blacktown|penrith|liverpool|campbelltown|bankstown|canterbury|auburn|strathfield|burwood|ashfield|leichhardt|marrickville|rockdale|kogarah|hurstville|sutherland|cronulla|miranda|caringbah|chatswood|willoughby|lane cove|ryde|hornsby|ku-ring-gai|manly|dee why|brookvale|mona vale|frenchs forest|castle hill|baulkham hills|epping|eastwood|macquarie park|north sydney|mosman|neutral bay|cremorne|crows nest|artarmon|st leonards|gordon|pymble|turramurra|wahroonga|lindfield|roseville|chullora|enfield|silverwater|auburn|homebush|rhodes|concord|five dock|drummoyne|balmain|rozelle|glebe|camperdown|newtown|erskineville|alexandria|redfern|surry hills|darlinghurst|paddington|bondi|coogee|maroubra|mascot|botany|kingsford|randwick|kensington|zetland|waterloo|green square)' THEN
    RETURN 'NSW_SYDNEY_METRO';
  END IF;
  
  -- NSW_REGIONAL - Rest of NSW
  IF loc ~ '(wollongong|shellharbour|nowra|kiama|illawarra|dubbo|orange|bathurst|wagga|albury|wodonga|tamworth|armidale|port macquarie|coffs harbour|grafton|lismore|ballina|byron|tweed|queanbeyan|goulburn|bowral|southern highlands|blue mountains|katoomba|lithgow|mudgee|griffith|leeton|young|cowra|forbes|parkes|broken hill|cobar|bourke|moree|inverell|glen innes|tenterfield|taree|forster|laurieton|wauchope|kempsey)' THEN
    RETURN 'NSW_REGIONAL';
  END IF;
  
  -- Generic NSW fallback
  IF loc ~ 'nsw' OR loc ~ 'new south wales' THEN
    RETURN 'NSW_REGIONAL';
  END IF;
  
  -- ==========================================================================
  -- OTHER STATES (lower priority for now)
  -- ==========================================================================
  IF loc ~ '(brisbane|eagle farm)' THEN RETURN 'QLD_BRISBANE'; END IF;
  IF loc ~ '(salisbury plain|salisbury|adelaide)' THEN RETURN 'SA_ADELAIDE'; END IF;
  IF loc ~ '(dandenong|melbourne|clayton|thomastown)' THEN RETURN 'VIC_MELBOURNE'; END IF;
  IF loc ~ '(perth|welshpool|osborne park)' THEN RETURN 'WA_PERTH'; END IF;
  IF loc ~ '(canberra)' THEN RETURN 'ACT'; END IF;
  IF loc ~ '(hobart|launceston)' THEN RETURN 'TAS'; END IF;
  IF loc ~ '(darwin)' THEN RETURN 'NT'; END IF;
  IF loc ~ '(gold coast|sunshine coast|cairns|townsville|toowoomba|rockhampton|mackay)' THEN RETURN 'QLD_REGIONAL'; END IF;
  IF loc ~ '(geelong|ballarat|bendigo|shepparton|traralgon)' THEN RETURN 'VIC_REGIONAL'; END IF;
  
  -- State-level fallbacks
  IF loc ~ 'vic' OR loc ~ 'victoria' THEN RETURN 'VIC_OTHER'; END IF;
  IF loc ~ 'qld' OR loc ~ 'queensland' THEN RETURN 'QLD_OTHER'; END IF;
  IF loc ~ 'sa' OR loc ~ 'south australia' THEN RETURN 'SA_OTHER'; END IF;
  IF loc ~ 'wa' OR loc ~ 'western australia' THEN RETURN 'WA_OTHER'; END IF;
  IF loc ~ 'tas' OR loc ~ 'tasmania' THEN RETURN 'TAS'; END IF;
  IF loc ~ 'nt' OR loc ~ 'northern territory' THEN RETURN 'NT'; END IF;
  IF loc ~ 'act' THEN RETURN 'ACT'; END IF;
  
  RETURN 'UNKNOWN';
END;
$function$;

-- ===========================================================================
-- Update existing rooftops to use new region bucket names
-- ===========================================================================
UPDATE public.dealer_rooftops 
SET region_id = 'NSW_CENTRAL_COAST' 
WHERE region_id = 'CENTRAL_COAST_NSW';

UPDATE public.dealer_groups 
SET region_id = 'NSW_CENTRAL_COAST' 
WHERE region_id = 'CENTRAL_COAST_NSW';

-- ===========================================================================
-- Add supported_platforms constraint tracking
-- ===========================================================================
COMMENT ON TABLE public.dealer_rooftops IS 'NSW Rooftop Registry. Only digitaldealer and adtorque parser_modes are supported for NSW ramp. Others are logged as unsupported.';