-- Update location_to_region function to add Central Coast NSW as a unified region
CREATE OR REPLACE FUNCTION public.location_to_region(p_location text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  loc text;
BEGIN
  IF p_location IS NULL OR trim(p_location) = '' THEN
    RETURN 'UNKNOWN';
  END IF;
  
  loc := lower(trim(p_location));
  
  -- Central Coast NSW - unified region bucket (before general NSW matching)
  IF loc ~ '(central coast|gosford|wyong|tuggerah|erina|terrigal|woy woy|umina|ettalong|kariong|kincumber|avoca|copacabana|bateau bay|the entrance|toukley|budgewoi|lake haven|berkeley vale|ourimbah|lisarow|niagara park|wyoming|narara|somersby|kulnura|wamberal|matcham|holgate)' THEN
    RETURN 'CENTRAL_COAST_NSW';
  END IF;
  
  -- Pickles yards and major hubs
  IF loc ~ '(eagle farm|brisbane)' THEN RETURN 'QLD_BRISBANE'; END IF;
  IF loc ~ '(salisbury plain|salisbury|adelaide)' THEN RETURN 'SA_ADELAIDE'; END IF;
  IF loc ~ '(dandenong|melbourne|clayton|thomastown)' THEN RETURN 'VIC_MELBOURNE'; END IF;
  IF loc ~ '(perth|welshpool|osborne park)' THEN RETURN 'WA_PERTH'; END IF;
  IF loc ~ '(sydney|silverwater|homebush|blacktown|penrith|parramatta|ryde|chatswood|brookvale|dee why|manly|mona vale)' THEN RETURN 'NSW_SYDNEY'; END IF;
  IF loc ~ '(newcastle|maitland|cessnock|muswellbrook)' THEN RETURN 'NSW_HUNTER'; END IF;
  IF loc ~ '(wollongong|shellharbour|nowra|kiama)' THEN RETURN 'NSW_ILLAWARRA'; END IF;
  IF loc ~ '(dubbo)' THEN RETURN 'NSW_WESTERN'; END IF;
  IF loc ~ '(canberra|queanbeyan)' THEN RETURN 'ACT'; END IF;
  IF loc ~ '(hobart|launceston)' THEN RETURN 'TAS'; END IF;
  IF loc ~ '(darwin)' THEN RETURN 'NT'; END IF;
  IF loc ~ '(gold coast|sunshine coast|cairns|townsville|toowoomba|rockhampton|mackay)' THEN RETURN 'QLD_REGIONAL'; END IF;
  IF loc ~ '(geelong|ballarat|bendigo|shepparton|wodonga|traralgon)' THEN RETURN 'VIC_REGIONAL'; END IF;
  
  -- State-level fallbacks
  IF loc ~ 'nsw' OR loc ~ 'new south wales' THEN RETURN 'NSW_OTHER'; END IF;
  IF loc ~ 'vic' OR loc ~ 'victoria' THEN RETURN 'VIC_OTHER'; END IF;
  IF loc ~ 'qld' OR loc ~ 'queensland' THEN RETURN 'QLD_OTHER'; END IF;
  IF loc ~ 'sa' OR loc ~ 'south australia' THEN RETURN 'SA_OTHER'; END IF;
  IF loc ~ 'wa' OR loc ~ 'western australia' THEN RETURN 'WA_OTHER'; END IF;
  IF loc ~ 'tas' OR loc ~ 'tasmania' THEN RETURN 'TAS'; END IF;
  IF loc ~ 'nt' OR loc ~ 'northern territory' THEN RETURN 'NT'; END IF;
  IF loc ~ 'act' THEN RETURN 'ACT'; END IF;
  
  RETURN 'UNKNOWN';
END;
$$;