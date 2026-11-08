SELECT s.event_id AS result_key,e.entity_id FROM structural_event s JOIN entity_record e
 ON e.table_name='structural_event' AND e.key_json=json_array(s.event_id);
