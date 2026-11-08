WITH scoped AS (
    SELECT *,json_array(catchment_id,country,crop,year,crop_status,contract_selection_status,
                        input_name,availability_status) AS result_key
    FROM nutrient_input_context
    WHERE (:year IS NULL OR year=:year)
      AND (:catchment_id IS NULL OR catchment_id=:catchment_id)
      AND (:country IS NULL OR country=:country)
      AND (:crop IS NULL OR crop=:crop)
      AND (:selection_status IS NULL OR contract_selection_status=:selection_status)
      AND (:crop_status IS NULL OR crop_status=:crop_status)
      AND (:input_name IS NULL OR input_name=:input_name)
)
SELECT s.result_key,e.entity_id
FROM scoped s JOIN entity_record e
  ON e.table_name='parcel_crop_year' AND e.key_json=json_array(s.parcel_id,s.year)
UNION
SELECT s.result_key,e.entity_id
FROM scoped s JOIN quality_scope qs ON qs.parcel_id=s.parcel_id AND qs.year=s.year
JOIN quality_finding_context q USING(finding_id)
JOIN entity_record e ON e.table_name='quality_finding' AND e.key_json=json_array(q.finding_id)
WHERE q.review_status!='dismissed';
