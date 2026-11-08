CREATE TABLE data_review_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','degraded','rules_only','failed','interrupted')),
  mode TEXT NOT NULL,
  model TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  local_rows INTEGER NOT NULL DEFAULT 0,
  ai_rows INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  tools_json TEXT NOT NULL DEFAULT '[]',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_data_reviews_batch ON data_review_runs(batch_id, created_at);
CREATE TABLE data_review_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES data_review_runs(id),
  issue_id TEXT NOT NULL REFERENCES dq_issues(id),
  origin TEXT NOT NULL CHECK (origin IN ('local','ai')),
  concern_status TEXT NOT NULL CHECK (concern_status IN ('NEEDS_HUMAN_REVIEW','NEEDS_EVIDENCE')),
  explanation TEXT NOT NULL,
  next_action TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  UNIQUE(run_id, issue_id, origin)
);
CREATE INDEX idx_data_review_findings_issue ON data_review_findings(issue_id);
CREATE TRIGGER data_review_findings_no_update BEFORE UPDATE ON data_review_findings BEGIN SELECT RAISE(ABORT, 'agent findings are append-only'); END;
CREATE TRIGGER data_review_findings_no_delete BEFORE DELETE ON data_review_findings BEGIN SELECT RAISE(ABORT, 'agent findings are append-only'); END;
