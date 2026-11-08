SELECT r.reference_id AS result_key,e.entity_id FROM reference_source r JOIN entity_record e
 ON e.table_name='reference_source' AND e.key_json=json_array(r.reference_id);
