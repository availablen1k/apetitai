WITH refs AS (
 SELECT 'material_factor' AS kind,r.material_id AS lookup_id,r.reported_ef_id AS reported_reference,
        r.factor_id AS resolved_reference,r.resolution_status,f.unit,f.kgco2e_per_unit,f.value_status
 FROM material_factor_resolution r LEFT JOIN emission_factor f ON f.ef_id=r.factor_id
 UNION ALL
 SELECT 'material_site',r.material_id,r.reported_site_id,r.site_id,r.resolution_status,NULL,NULL,NULL FROM material_site_resolution r
 UNION ALL
 SELECT 'erp_site',r.purchase_record_id,r.reported_plant,r.site_id,r.resolution_status,NULL,NULL,NULL FROM erp_site_resolution r
)
SELECT kind || ':' || lookup_id AS result_key,* FROM refs
WHERE kind=:kind AND (:lookup_id IS NULL OR lookup_id=:lookup_id)
ORDER BY lookup_id LIMIT :limit OFFSET :offset;
