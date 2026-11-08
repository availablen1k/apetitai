SELECT c.catchment_id AS result_key, e.entity_id
FROM catchment c JOIN entity_record e ON e.table_name = 'catchment'
 AND e.key_json = json_array(c.catchment_id)
UNION
SELECT m.catchment_id AS result_key, e.entity_id
FROM catchment_monitoring m JOIN entity_record e ON e.table_name = 'catchment_monitoring'
 AND e.key_json = json_array(m.catchment_id, m.year);
