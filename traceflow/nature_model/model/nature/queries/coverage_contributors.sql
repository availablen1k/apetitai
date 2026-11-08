SELECT f.country || ':' || y.crop || ':' || y.year AS result_key,e.entity_id
FROM parcel_crop_year y JOIN parcel p USING(parcel_id) JOIN farm f USING(farm_id)
JOIN entity_record e ON e.table_name='parcel_crop_year' AND e.key_json=json_array(y.parcel_id,y.year)
WHERE y.crop_status='declared' AND y.is_contract_crop_provisional=1
 AND (:year IS NULL OR y.year=:year) AND (:country IS NULL OR f.country=:country)
 AND (:crop IS NULL OR y.crop=:crop);
