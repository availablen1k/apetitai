SELECT s.catchment_id || ':' || s.year AS result_key,s.catchment_id,s.year,
       COUNT(DISTINCT s.finding_id) AS distinct_finding_count,
       COUNT(DISTINCT s.parcel_id) AS fields_with_findings
FROM quality_scope s JOIN quality_finding_context f USING(finding_id)
WHERE (:year IS NULL OR s.year=:year) AND (:catchment_id IS NULL OR s.catchment_id=:catchment_id)
 AND f.review_status!='dismissed'
GROUP BY s.catchment_id,s.year ORDER BY s.year,s.catchment_id;
