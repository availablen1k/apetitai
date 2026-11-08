SELECT m.evidence_id AS result_key,e.entity_id FROM method_evidence m JOIN entity_record e
 ON e.table_name='method_evidence' AND e.key_json=json_array(m.evidence_id);
