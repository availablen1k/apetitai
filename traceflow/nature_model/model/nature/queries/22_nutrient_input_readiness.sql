WITH scoped AS (
    SELECT * FROM nutrient_input_context
    WHERE (:year IS NULL OR year=:year)
      AND (:catchment_id IS NULL OR catchment_id=:catchment_id)
      AND (:country IS NULL OR country=:country)
      AND (:crop IS NULL OR crop=:crop)
      AND (:selection_status IS NULL OR contract_selection_status=:selection_status)
      AND (:crop_status IS NULL OR crop_status=:crop_status)
      AND (:input_name IS NULL OR input_name=:input_name)
), flagged AS (
    SELECT s.*, EXISTS (
        SELECT 1 FROM quality_scope qs JOIN quality_finding_context q USING(finding_id)
        WHERE qs.parcel_id=s.parcel_id AND qs.year=s.year AND q.review_status!='dismissed'
    ) AS has_open_quality_finding
    FROM scoped s
)
SELECT json_array(catchment_id,country,crop,year,crop_status,contract_selection_status,
                  input_name,availability_status) AS result_key,
       catchment_id,country,crop,year,crop_status,contract_selection_status,
       input_name,unit,input_origin,availability_status,coverage_policy_version,policy_review_state,
       COUNT(*) AS field_count,COUNT(DISTINCT observation_id) AS distinct_report_count,
       ROUND(SUM(area_ha),6) AS mapped_area_ha,
       SUM(CASE WHEN area_difference_over_5pct=1 THEN 1 ELSE 0 END) AS fields_with_area_discrepancy,
       SUM(has_open_quality_finding) AS fields_with_open_quality_findings
FROM flagged
GROUP BY catchment_id,country,crop,year,crop_status,contract_selection_status,
         input_name,availability_status
ORDER BY year,catchment_id,country,crop,crop_status,contract_selection_status,input_name,availability_status;
