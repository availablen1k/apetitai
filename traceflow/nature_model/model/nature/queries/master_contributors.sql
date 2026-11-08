SELECT 'material_factor:' || r.material_id AS result_key,e.entity_id
FROM material_factor_resolution r JOIN entity_record e ON e.table_name='material_factor_resolution' AND e.key_json=json_array(r.material_id)
UNION
SELECT 'material_site:' || r.material_id,e.entity_id
FROM material_site_resolution r JOIN entity_record e ON e.table_name='material_site_resolution' AND e.key_json=json_array(r.material_id)
UNION
SELECT 'erp_site:' || r.purchase_record_id,e.entity_id
FROM erp_site_resolution r JOIN entity_record e ON e.table_name='erp_site_resolution' AND e.key_json=json_array(r.purchase_record_id);
