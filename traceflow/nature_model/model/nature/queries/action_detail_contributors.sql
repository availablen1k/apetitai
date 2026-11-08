SELECT l.lever_id AS result_key,e.entity_id FROM action_lever l JOIN entity_record e
 ON e.table_name='action_lever' AND e.key_json=json_array(l.lever_id)
UNION
SELECT r.lever_id,e.entity_id FROM nature_action_rule r JOIN entity_record e
 ON e.table_name='nature_action_rule' AND e.key_json=json_array(r.rule_id);
