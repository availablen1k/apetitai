SELECT f.farm_id AS result_key,e.entity_id FROM farm f JOIN entity_record e
 ON e.table_name='farm' AND e.key_json=json_array(f.farm_id)
UNION
SELECT p.farm_id,e.entity_id FROM parcel p JOIN entity_record e
 ON e.table_name='parcel' AND e.key_json=json_array(p.parcel_id);
