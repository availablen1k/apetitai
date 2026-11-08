-- Ecological context only: this ordering is NOT the Track D pollution priority rank.
SELECT catchment_id AS result_key, region, receiving_water_type,
       ecological_status_class, p_sensitivity, nutrient_retention_frac_estimate,
       monitoring_station
FROM catchment
ORDER BY CASE ecological_status_class WHEN 'bad' THEN 4 WHEN 'poor' THEN 3
         WHEN 'moderate' THEN 2 WHEN 'good' THEN 1 ELSE 0 END DESC,
         p_sensitivity DESC, catchment_id;
