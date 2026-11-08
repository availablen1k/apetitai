SELECT c.catchment_id AS result_key, e.entity_id
FROM catchment c JOIN entity_record e ON e.table_name = 'catchment'
 AND e.key_json = json_array(c.catchment_id);
