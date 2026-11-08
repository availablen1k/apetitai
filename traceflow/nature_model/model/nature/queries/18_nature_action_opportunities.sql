SELECT p.catchment_id || ':' || a.year || ':' || a.lever_id AS result_key,
       p.catchment_id,c.region,a.year AS evidence_year,y.crop_status,a.lever_id,l.name,
       COUNT(*) AS candidate_field_count,COUNT(DISTINCT p.farm_id) AS candidate_farm_count,
       ROUND(SUM(p.area_ha),2) AS candidate_area_ha,
       SUM(y.observation_id IS NULL) AS fields_without_management_report,
       c.ecological_status_class,c.p_sensitivity,l.earliest_start,:planning_year AS planning_year,
       (:planning_year>=l.earliest_start) AS catalogue_start_year_reached,
       r.efficacy_status,'requires_expert_assessment' AS screening_status
FROM nature_action_candidate a JOIN parcel_crop_year y USING(parcel_id,year)
JOIN parcel p USING(parcel_id) JOIN catchment c USING(catchment_id)
JOIN action_lever l USING(lever_id) JOIN nature_action_rule r ON r.rule_id=a.rule_id
WHERE a.year=:year AND y.crop_status=:crop_status
 AND (:catchment_id IS NULL OR p.catchment_id=:catchment_id) AND (:lever_id IS NULL OR a.lever_id=:lever_id)
GROUP BY p.catchment_id,a.year,a.lever_id ORDER BY p.catchment_id,a.lever_id;
