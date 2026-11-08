-- Grain: one catchment in 2025, including catchments with no selected fields.
WITH a AS (
    SELECT catchment_id, COUNT(*) AS contract_field_count,
           COUNT(DISTINCT farm_id) AS contract_farm_count, SUM(area_ha) AS contract_area_ha
    FROM field_context WHERE year = :year AND is_contract_crop_provisional = 1
    GROUP BY catchment_id
)
SELECT c.catchment_id AS result_key, c.region,
       COALESCE(a.contract_field_count, 0) AS contract_field_count,
       COALESCE(a.contract_farm_count, 0) AS contract_farm_count,
       ROUND(COALESCE(a.contract_area_ha, 0), 2) AS contract_area_ha
FROM catchment c LEFT JOIN a ON a.catchment_id = c.catchment_id
ORDER BY contract_area_ha DESC, c.catchment_id;
