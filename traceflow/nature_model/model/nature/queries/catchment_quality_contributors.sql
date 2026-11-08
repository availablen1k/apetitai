SELECT DISTINCT s.catchment_id || ':' || s.year AS result_key,e.entity_id
FROM quality_scope s JOIN quality_finding_context f USING(finding_id)
JOIN entity_record e ON e.table_name='quality_finding' AND e.key_json=json_array(s.finding_id)
WHERE (:year IS NULL OR s.year=:year) AND (:catchment_id IS NULL OR s.catchment_id=:catchment_id)
 AND f.review_status!='dismissed';
