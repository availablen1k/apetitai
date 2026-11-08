SELECT parcel_id || ':' || year AS result_key,parcel_id,year,crop_status,crop,
       area_ha,catchment_id,observation_id,reported_p_kg_ha,contract_selection_status
FROM field_context WHERE parcel_id=:parcel_id
 AND (:start_year IS NULL OR year>=:start_year) AND (:end_year IS NULL OR year<=:end_year)
ORDER BY year;
