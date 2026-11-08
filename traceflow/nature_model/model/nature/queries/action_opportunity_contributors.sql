SELECT p.catchment_id || ':' || a.year || ':' || a.lever_id AS result_key,e.entity_id
FROM nature_action_candidate a JOIN parcel p USING(parcel_id) JOIN parcel_crop_year y USING(parcel_id,year)
JOIN entity_record e ON e.table_name='nature_action_candidate' AND e.key_json=json_array(a.parcel_id,a.year,a.lever_id)
WHERE a.year=:year AND y.crop_status=:crop_status
 AND (:catchment_id IS NULL OR p.catchment_id=:catchment_id) AND (:lever_id IS NULL OR a.lever_id=:lever_id);
