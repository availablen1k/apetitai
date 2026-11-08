-- Evidence documents (any file type) linked to issues, routes, suppliers or records, their locally
-- extracted text, and AI extractions. Files and extractions are append-only.

CREATE TABLE evidence_files (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  sha256        TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  stored_path   TEXT,
  text_status   TEXT NOT NULL CHECK (text_status IN ('extracted', 'converted_and_extracted', 'no_text_layer', 'not_readable_locally', 'failed')),
  text_method   TEXT,
  page_count    INTEGER,
  text_chars    INTEGER NOT NULL DEFAULT 0,
  pages_json    TEXT NOT NULL DEFAULT '[]',
  note          TEXT,
  uploaded_at   TEXT NOT NULL
);
CREATE TRIGGER evidence_files_no_update BEFORE UPDATE ON evidence_files
BEGIN SELECT RAISE(ABORT, 'evidence files are immutable'); END;
CREATE TRIGGER evidence_files_no_delete BEFORE DELETE ON evidence_files
BEGIN SELECT RAISE(ABORT, 'evidence files are immutable'); END;

CREATE TABLE evidence_links (
  id           TEXT PRIMARY KEY,
  evidence_id  TEXT NOT NULL REFERENCES evidence_files(id),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('dq_issue', 'route_proposal', 'supplier', 'material', 'source_record', 'shipment')),
  entity_id    TEXT NOT NULL,
  label        TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (evidence_id, entity_type, entity_id)
);
CREATE INDEX idx_evidence_links_entity ON evidence_links(entity_type, entity_id);
CREATE TRIGGER evidence_links_no_update BEFORE UPDATE ON evidence_links
BEGIN SELECT RAISE(ABORT, 'evidence links are append-only'); END;
CREATE TRIGGER evidence_links_no_delete BEFORE DELETE ON evidence_links
BEGIN SELECT RAISE(ABORT, 'evidence links are append-only'); END;

CREATE TABLE evidence_extractions (
  id            TEXT PRIMARY KEY,
  evidence_id   TEXT NOT NULL REFERENCES evidence_files(id),
  issue_id      TEXT REFERENCES dq_issues(id),
  mode          TEXT NOT NULL CHECK (mode IN ('gemini', 'stub')),
  model         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  input_basis   TEXT NOT NULL,
  result_json   TEXT,
  error         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_extractions_evidence ON evidence_extractions(evidence_id);
CREATE TRIGGER extractions_no_update BEFORE UPDATE ON evidence_extractions
BEGIN SELECT RAISE(ABORT, 'extractions are append-only'); END;
CREATE TRIGGER extractions_no_delete BEFORE DELETE ON evidence_extractions
BEGIN SELECT RAISE(ABORT, 'extractions are append-only'); END;

-- Column mapping used when an unfamiliar CSV/XLSX layout was imported into a known dataset.
ALTER TABLE import_batches ADD COLUMN mapping_json TEXT;
