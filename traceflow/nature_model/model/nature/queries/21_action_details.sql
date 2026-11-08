SELECT l.lever_id AS result_key,l.*,r.rule_id,r.version AS screening_rule_version,
       r.predicate,r.description AS screening_description,r.prerequisites,r.efficacy_status,
       'catalogue_programme_estimate_not_allocated' AS cost_basis
FROM action_lever l LEFT JOIN nature_action_rule r USING(lever_id)
WHERE (:lever_id IS NULL OR l.lever_id=:lever_id) ORDER BY l.lever_id;
