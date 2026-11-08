-- Grain: one catchment. NULL percentages mean no selected contract fields.
WITH a AS (
    SELECT catchment_id, COUNT(*) AS contract_field_count, SUM(area_ha) AS area_ha,
           SUM(observation_id IS NULL) AS fields_without_report,
           SUM(CASE WHEN observation_id IS NULL THEN area_ha ELSE 0 END) AS area_without_report,
           SUM(reported_p_kg_ha IS NULL) AS fields_without_p_application,
           SUM(p_test_mgl_latest IS NULL) AS fields_without_soil_p
    FROM field_context WHERE year = :year AND is_contract_crop_provisional = 1
    GROUP BY catchment_id
)
SELECT c.catchment_id AS result_key, COALESCE(a.contract_field_count, 0) AS contract_field_count,
       COALESCE(a.fields_without_report, 0) AS fields_without_report,
       COALESCE(a.fields_without_p_application, 0) AS fields_without_p_application,
       COALESCE(a.fields_without_soil_p, 0) AS fields_without_soil_p,
       ROUND(100.0 * a.area_without_report / NULLIF(a.area_ha, 0), 2) AS area_without_report_pct
FROM catchment c LEFT JOIN a ON a.catchment_id = c.catchment_id
ORDER BY fields_without_report DESC, c.catchment_id;
