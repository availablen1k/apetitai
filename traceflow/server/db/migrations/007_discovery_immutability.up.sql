-- Keep discovery evidence immutable in databases that already applied migration 006.
CREATE TRIGGER discovery_findings_no_delete BEFORE DELETE ON discovery_findings
BEGIN SELECT RAISE(ABORT, 'discovery findings are immutable'); END;
