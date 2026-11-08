SELECT event_id AS result_key,date,event,type,relevance,source
FROM structural_event WHERE (:start_date IS NULL OR date>=:start_date)
 AND (:end_date IS NULL OR date<=:end_date) AND (:type IS NULL OR type=:type)
ORDER BY date,event_id;
