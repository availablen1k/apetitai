SELECT f.farm_id || ':' || f.crop || ':' || f.year AS result_key,e.entity_id
FROM field_context f JOIN entity_record e ON e.table_name='parcel_crop_year' AND e.key_json=json_array(f.parcel_id,f.year)
WHERE f.year=:year AND f.crop_status='declared' AND f.is_contract_crop_provisional=1
 AND (:country IS NULL OR f.country=:country)
UNION
SELECT p.farm_id || ':' || m.crop || ':' || p.year AS result_key,e.entity_id
FROM erp_purchase p JOIN material_crop_mapping m ON m.material_id=p.resolved_material_id
JOIN farm f ON f.farm_id=p.farm_id
JOIN entity_record e ON e.table_name='erp_purchase' AND e.key_json=json_array(p.purchase_record_id)
WHERE p.year=:year AND (:country IS NULL OR f.country=:country);
