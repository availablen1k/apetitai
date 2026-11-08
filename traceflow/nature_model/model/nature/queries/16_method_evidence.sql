SELECT e.evidence_id AS result_key,m.method_id,m.name,m.purpose,m.implementation_status,
       m.interpretation,m.review_status,e.evidence_role,e.note,d.relative_path,
       s.heading,s.start_line,s.end_line,s.section_text,f.sha256 AS document_sha256,
       d.verification_status AS document_verification,r.source AS reference_name,
       r.url,r.licence,r.verification_status AS reference_verification
FROM method_evidence e JOIN method_context m USING(method_id)
LEFT JOIN evidence_section s USING(section_id) LEFT JOIN evidence_document d USING(document_id)
LEFT JOIN source_file f ON f.source_id=d.source_id LEFT JOIN reference_source r USING(reference_id)
WHERE (:method_id IS NULL OR m.method_id=:method_id)
 AND (:table_name IS NULL OR EXISTS(SELECT 1 FROM model_method_link l WHERE l.method_id=m.method_id AND l.table_name=:table_name))
ORDER BY m.method_id,e.evidence_id;
