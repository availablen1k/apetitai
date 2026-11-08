-- Data discovery: deterministic findings (what we found -> what we suggest -> effect), worded in
-- plain language by hidden expert agents. Decisions are append-only and keyed by a stable finding
-- key, so a finding handled or dismissed once stays that way in later runs until reopened.
CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE,
  year INTEGER NOT NULL,
  calc_run_id TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','degraded','local_only','failed','interrupted')),
  mode TEXT NOT NULL,
  model TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  ai_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_discovery_runs_year ON discovery_runs(year, created_at);

CREATE TABLE discovery_findings (
  id TEXT PRIMARY KEY,
  discovery_run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  finding_key TEXT NOT NULL,
  expert TEXT NOT NULL,
  kind TEXT NOT NULL,
  rank INTEGER NOT NULL,
  found_en TEXT NOT NULL,
  found_fi TEXT NOT NULL,
  suggest_en TEXT NOT NULL,
  suggest_fi TEXT NOT NULL,
  who_json TEXT NOT NULL,
  effect_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  wording TEXT NOT NULL CHECK (wording IN ('ai','template')),
  check_json TEXT NOT NULL,
  UNIQUE (discovery_run_id, finding_key)
);
CREATE TRIGGER discovery_findings_no_update BEFORE UPDATE ON discovery_findings
BEGIN SELECT RAISE(ABORT, 'discovery findings are immutable'); END;

CREATE TABLE discovery_decisions (
  id TEXT PRIMARY KEY,
  finding_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('done','dismissed','reopened')),
  reviewer_label TEXT NOT NULL,
  note TEXT,
  decided_at TEXT NOT NULL
);
CREATE INDEX idx_discovery_decisions_key ON discovery_decisions(finding_key, decided_at);
CREATE TRIGGER discovery_decisions_no_update BEFORE UPDATE ON discovery_decisions
BEGIN SELECT RAISE(ABORT, 'discovery decisions are append-only'); END;
CREATE TRIGGER discovery_decisions_no_delete BEFORE DELETE ON discovery_decisions
BEGIN SELECT RAISE(ABORT, 'discovery decisions are append-only'); END;
