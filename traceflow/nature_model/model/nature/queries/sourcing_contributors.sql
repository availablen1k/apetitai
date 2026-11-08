SELECT p.material_id || ':' || p.origin_country || ':' || p.year AS result_key,e.entity_id
FROM erp_purchase p JOIN entity_record e ON e.table_name='erp_purchase' AND e.key_json=json_array(p.purchase_record_id)
WHERE p.year=:year AND (:origin_country IS NULL OR p.origin_country=:origin_country)
 AND (:material_id IS NULL OR p.material_id=:material_id)
UNION
SELECT p.material_id || ':' || p.origin_country || ':' || p.year AS result_key,n.entity_id
FROM erp_purchase p JOIN entity_record e ON e.table_name='erp_purchase' AND e.key_json=json_array(p.purchase_record_id)
JOIN quality_finding f ON f.entity_id=e.entity_id JOIN entity_record n ON n.table_name='quality_finding' AND n.key_json=json_array(f.finding_id)
WHERE p.year=:year AND (:origin_country IS NULL OR p.origin_country=:origin_country)
 AND (:material_id IS NULL OR p.material_id=:material_id);
