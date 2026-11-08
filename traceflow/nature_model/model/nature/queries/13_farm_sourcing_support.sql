WITH fields AS (
 SELECT farm_id,crop,year,country,COUNT(*) AS field_count,SUM(area_ha) AS mapped_area_ha
 FROM field_context WHERE year=:year AND crop_status='declared' AND is_contract_crop_provisional=1
 AND (:country IS NULL OR country=:country) GROUP BY farm_id,crop,year,country
)
SELECT f.farm_id || ':' || f.crop || ':' || f.year AS result_key,f.farm_id,f.crop,f.year,f.country,
       f.field_count,ROUND(f.mapped_area_ha,2) AS mapped_area_ha,
       COALESCE(p.purchase_record_count,0) AS matching_purchase_record_count,
       p.reported_net_quantity_kg,p.records_without_mass_conversion,
       CASE WHEN p.purchase_record_count IS NULL THEN 'no_matching_purchase'
            WHEN p.reported_net_quantity_kg>0 THEN 'positive_reported_net_purchase'
            ELSE 'purchase_present_without_positive_net_mass' END AS reported_purchase_support
FROM fields f LEFT JOIN farm_crop_purchases p USING(farm_id,crop,year)
ORDER BY f.country,f.farm_id,f.crop;
