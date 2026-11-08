SELECT parcel_id || ':' || year || ':' || scenario AS result_key,
       parcel_id,farm_id,catchment_id,year,crop_status,crop,scenario,
       cell_id,climate_grid_distance_km,mapping_status,months_present,
       annual_precip_mm,annual_pet_mm,apr_sep_precip_mm,apr_sep_pet_mm
FROM field_climate_context
WHERE year=:year AND scenario=:scenario
 AND (:parcel_id IS NULL OR parcel_id=:parcel_id)
 AND (:catchment_id IS NULL OR catchment_id=:catchment_id)
ORDER BY parcel_id LIMIT :limit OFFSET :offset;
