SELECT finding_id AS result_key,rule_id,rule_version,issue_type,severity,year,field_name,
       observed_json,expected_json,explanation,review_status,entity_id,source_record_id
FROM quality_finding_context
WHERE (:year IS NULL OR year=:year OR year IS NULL)
 AND (:rule_id IS NULL OR rule_id=:rule_id)
 AND (:review_status IS NULL OR review_status=:review_status)
ORDER BY rule_id,COALESCE(year,0),finding_id LIMIT :limit OFFSET :offset;
