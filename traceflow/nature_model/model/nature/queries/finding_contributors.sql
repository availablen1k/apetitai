SELECT f.finding_id AS result_key,e.entity_id FROM quality_finding f
JOIN entity_record e ON e.table_name='quality_finding' AND e.key_json=json_array(f.finding_id);
