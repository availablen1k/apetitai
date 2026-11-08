-- Classification is separate from immutable source data. Decisions and OCR readings retain history.
CREATE TABLE upload_inbox (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence_files(id),
  sheet_names_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE upload_decisions (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES upload_inbox(id),
  destination TEXT NOT NULL CHECK (destination IN ('dataset', 'evidence')),
  dataset TEXT,
  sheet TEXT,
  document_type TEXT NOT NULL,
  reporting_year INTEGER,
  reviewer_label TEXT NOT NULL,
  import_batch_id TEXT REFERENCES import_batches(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_upload_decisions_upload ON upload_decisions(upload_id, created_at);
CREATE TRIGGER upload_decisions_no_update BEFORE UPDATE ON upload_decisions BEGIN SELECT RAISE(ABORT, 'upload decisions are append-only'); END;
CREATE TRIGGER upload_decisions_no_delete BEFORE DELETE ON upload_decisions BEGIN SELECT RAISE(ABORT, 'upload decisions are append-only'); END;

CREATE TABLE evidence_text_runs (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence_files(id),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'unavailable')),
  method TEXT NOT NULL,
  pages_json TEXT NOT NULL DEFAULT '[]',
  page_count INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_text_runs_file ON evidence_text_runs(evidence_id, created_at);
CREATE TRIGGER evidence_text_runs_no_update BEFORE UPDATE ON evidence_text_runs BEGIN SELECT RAISE(ABORT, 'text readings are append-only'); END;
CREATE TRIGGER evidence_text_runs_no_delete BEFORE DELETE ON evidence_text_runs BEGIN SELECT RAISE(ABORT, 'text readings are append-only'); END;
