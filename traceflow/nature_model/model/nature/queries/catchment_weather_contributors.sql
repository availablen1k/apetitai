SELECT f.catchment_id || ':' || f.year || ':' || f.scenario AS result_key,e.entity_id
FROM field_climate_context f JOIN entity_record e ON
 (e.table_name='parcel_crop_year' AND e.key_json=json_array(f.parcel_id,f.year)) OR
 (e.table_name='parcel_climate_mapping' AND e.key_json=json_array(f.parcel_id)) OR
 (e.table_name='weather_annual' AND e.key_json=json_array(f.cell_id,f.scenario,f.year))
WHERE f.year=:year AND f.scenario=:scenario AND f.is_contract_crop_provisional=1
 AND (:catchment_id IS NULL OR f.catchment_id=:catchment_id);
