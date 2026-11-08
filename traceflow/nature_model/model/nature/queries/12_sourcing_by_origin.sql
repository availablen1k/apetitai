WITH totals AS (
 SELECT material_id,origin_country,year,COUNT(*) AS source_record_count,
        SUM(movement_type=122) AS return_record_count,
        SUM(quantity_kg IS NULL) AS non_mass_record_count,
        SUM(quantity_kg) AS reported_net_quantity_kg,
        SUM(amount_eur_reference_rate) AS net_amount_eur_reference_rate,
        GROUP_CONCAT(DISTINCT currency) AS source_currencies
 FROM erp_purchase WHERE year=:year AND (:origin_country IS NULL OR origin_country=:origin_country)
 AND (:material_id IS NULL OR material_id=:material_id)
 GROUP BY material_id,origin_country,year
), findings AS (
 SELECT e.material_id,e.origin_country,e.year,COUNT(DISTINCT f.finding_id) AS review_candidate_count
 FROM erp_purchase e JOIN entity_record n ON n.table_name='erp_purchase' AND n.key_json=json_array(e.purchase_record_id)
 JOIN quality_finding f ON f.entity_id=n.entity_id GROUP BY e.material_id,e.origin_country,e.year
)
SELECT t.material_id || ':' || t.origin_country || ':' || t.year AS result_key,t.*,
       COALESCE(f.review_candidate_count,0) AS review_candidate_count
FROM totals t LEFT JOIN findings f USING(material_id,origin_country,year)
ORDER BY t.material_id,t.origin_country;
