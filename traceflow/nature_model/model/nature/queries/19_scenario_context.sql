SELECT s.scenario || ':' || s.year AS result_key,s.*,
       (SELECT COUNT(*) FROM weather_annual w WHERE w.scenario=s.physical_pathway_proxy AND w.year=s.year) AS matching_weather_grid_count
FROM transition_scenario s WHERE s.scenario=:scenario AND s.year=:year;
