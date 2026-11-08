SELECT country || ':' || crop || ':' || year AS result_key, country,crop,year,
       COUNT(*) AS field_count, ROUND(SUM(area_ha),2) AS mapped_area_ha,
       SUM(observation_id IS NULL) AS fields_without_report,
       SUM(reported_p_kg_ha IS NULL) AS fields_without_p_application
FROM field_context
WHERE crop_status='declared' AND is_contract_crop_provisional=1
 AND (:year IS NULL OR year=:year) AND (:country IS NULL OR country=:country)
 AND (:crop IS NULL OR crop=:crop)
GROUP BY country,crop,year ORDER BY year,country,crop;
