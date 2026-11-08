SELECT s.scenario || ':' || s.year AS result_key,e.entity_id
FROM transition_scenario s JOIN entity_record e ON e.table_name='transition_scenario' AND e.key_json=json_array(s.scenario,s.year)
WHERE s.scenario=:scenario AND s.year=:year
UNION
SELECT s.scenario || ':' || s.year,e.entity_id FROM transition_scenario s
JOIN weather_annual w ON w.scenario=s.physical_pathway_proxy AND w.year=s.year
JOIN entity_record e ON e.table_name='weather_annual' AND e.key_json=json_array(w.cell_id,w.scenario,w.year)
WHERE s.scenario=:scenario AND s.year=:year;
