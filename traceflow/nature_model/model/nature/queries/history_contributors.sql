SELECT y.parcel_id || ':' || y.year AS result_key,e.entity_id
FROM parcel_crop_year y JOIN entity_record e
 ON e.table_name='parcel_crop_year' AND e.key_json=json_array(y.parcel_id,y.year)
WHERE y.parcel_id=:parcel_id AND (:start_year IS NULL OR y.year>=:start_year)
 AND (:end_year IS NULL OR y.year<=:end_year);
