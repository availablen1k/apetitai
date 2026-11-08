SELECT reference_id AS result_key,source,url,licence,used_for,verification_status
FROM reference_source
WHERE (:search IS NULL OR instr(lower(source || ' ' || used_for),lower(:search))>0)
ORDER BY source;
