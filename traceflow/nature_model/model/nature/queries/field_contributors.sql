-- Row-level contributors for queries 01 and 02, before aggregation or rounding.
SELECT c.catchment_id AS result_key, e.entity_id
FROM catchment c JOIN entity_record e ON e.table_name = 'catchment'
 AND e.key_json = json_array(c.catchment_id)
UNION
SELECT p.catchment_id AS result_key, e.entity_id
FROM parcel_crop_year y JOIN parcel p ON p.parcel_id = y.parcel_id
JOIN entity_record e ON e.table_name = 'parcel_crop_year'
 AND e.key_json = json_array(y.parcel_id, y.year)
WHERE y.year = :year AND y.is_contract_crop_provisional = 1;
