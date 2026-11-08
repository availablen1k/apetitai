SELECT catchment_id || ':' || year || ':' || scenario AS result_key,catchment_id,year,scenario,
       COUNT(*) AS contract_field_count,ROUND(SUM(area_ha),2) AS mapped_contract_area_ha,
       SUM(annual_precip_mm IS NOT NULL) AS fields_with_complete_annual_weather,
       ROUND(SUM(annual_precip_mm*area_ha)/NULLIF(SUM(CASE WHEN annual_precip_mm IS NOT NULL THEN area_ha ELSE 0 END),0),3) AS area_weighted_annual_precip_mm
FROM field_climate_context
WHERE year=:year AND scenario=:scenario AND is_contract_crop_provisional=1
 AND (:catchment_id IS NULL OR catchment_id=:catchment_id)
GROUP BY catchment_id,year,scenario ORDER BY catchment_id;
