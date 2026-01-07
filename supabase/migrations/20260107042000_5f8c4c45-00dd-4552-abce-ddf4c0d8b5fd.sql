-- Update location_to_region function with expanded mappings
CREATE OR REPLACE FUNCTION public.location_to_region(p_location text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- NSW
    WHEN lower(coalesce(p_location,'')) ~ '\y(nsw|new south wales|sydney|penrith|milperra|dubbo|newcastle|wollongong|central coast|gosford|wyong|tamworth|wagga|albury|orange|bathurst|lismore|coffs harbour|port macquarie|maitland|cessnock|armidale|broken hill|griffith|queanbeyan)\y' THEN 'NSW'
    -- VIC
    WHEN lower(coalesce(p_location,'')) ~ '\y(vic|victoria|melbourne|laverton|dandenong|geelong|ballarat|bendigo|shepparton|mildura|warrnambool|traralgon|wodonga|frankston|sunbury|melton|pakenham|cranbourne|werribee)\y' THEN 'VIC'
    -- QLD
    WHEN lower(coalesce(p_location,'')) ~ '\y(qld|queensland|brisbane|gold coast|townsville|cairns|yatala|rockhampton|toowoomba|mackay|bundaberg|hervey bay|gladstone|mount isa|maryborough|gympie|ipswich|logan|redcliffe|caboolture|caloundra|maroochydore|nambour)\y' THEN 'QLD'
    -- SA
    WHEN lower(coalesce(p_location,'')) ~ '\y(sa|south australia|adelaide|lonsdale|salisbury|salisbury plain|elizabeth|port augusta|whyalla|mount gambier|murray bridge|port pirie|port lincoln|gawler|victor harbor)\y' THEN 'SA'
    -- WA
    WHEN lower(coalesce(p_location,'')) ~ '\y(wa|western australia|perth|canning vale|belmont|fremantle|rockingham|mandurah|bunbury|geraldton|kalgoorlie|albany|broome|karratha|port hedland|joondalup|midland|armadale|wanneroo)\y' THEN 'WA'
    -- TAS
    WHEN lower(coalesce(p_location,'')) ~ '\y(tas|tasmania|hobart|moonah|launceston|devonport|burnie|ulverstone|kingston|glenorchy|clarence|kingborough)\y' THEN 'TAS'
    -- NT
    WHEN lower(coalesce(p_location,'')) ~ '\y(nt|northern territory|darwin|winnellie|alice springs|katherine|palmerston|tennant creek|nhulunbuy)\y' THEN 'NT'
    -- ACT
    WHEN lower(coalesce(p_location,'')) ~ '\y(act|canberra|belconnen|tuggeranong|woden|gungahlin|fyshwick|mitchell)\y' THEN 'ACT'
    ELSE 'UNKNOWN'
  END;
$function$;