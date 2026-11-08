-- Whole-catchment observations. Endpoint change is descriptive, not a fitted trend.
WITH m AS (
    SELECT catchment_id, COUNT(*) AS observed_year_count,
           MIN(year) AS first_observed_year, MAX(year) AS last_observed_year,
           MAX(CASE WHEN year = 2019 THEN total_p_load_kg END) AS p_2019_kg,
           MAX(CASE WHEN year = 2025 THEN total_p_load_kg END) AS p_2025_kg,
           MAX(CASE WHEN year = 2019 THEN total_n_load_kg END) AS n_2019_kg,
           MAX(CASE WHEN year = 2025 THEN total_n_load_kg END) AS n_2025_kg
    FROM catchment_monitoring GROUP BY catchment_id
)
SELECT c.catchment_id AS result_key, COALESCE(m.observed_year_count, 0) AS observed_year_count,
       m.first_observed_year, m.last_observed_year,
       m.p_2019_kg, m.p_2025_kg, m.n_2019_kg, m.n_2025_kg,
       ROUND(100.0 * (m.p_2025_kg - m.p_2019_kg) / NULLIF(m.p_2019_kg, 0), 2) AS p_change_pct,
       ROUND(100.0 * (m.n_2025_kg - m.n_2019_kg) / NULLIF(m.n_2019_kg, 0), 2) AS n_change_pct
FROM catchment c LEFT JOIN m ON m.catchment_id = c.catchment_id
ORDER BY c.catchment_id;
