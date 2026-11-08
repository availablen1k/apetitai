SELECT f.finding_id AS result_key,o.observation_id,o.farm_id,o.crop,o.year,
       o.reported_area_ha, f.expected_json AS mapped_area_context_json,f.review_status
FROM quality_finding_context f JOIN entity_record e ON e.entity_id=f.entity_id
JOIN farm_crop_observation o ON e.table_name='farm_crop_observation' AND e.key_json=json_array(o.observation_id)
WHERE f.rule_id='area_difference' AND (:year IS NULL OR o.year=:year)
ORDER BY o.year,o.farm_id,o.crop LIMIT :limit OFFSET :offset;
