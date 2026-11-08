-- TraceFlow local schema. Source rows, corrections, calculation runs and audit events are
-- append-only: triggers reject UPDATE and DELETE so the history cannot be rewritten.

CREATE TABLE import_batches (
  id              TEXT PRIMARY KEY,
  filename        TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  dataset         TEXT NOT NULL,
  file_format     TEXT NOT NULL CHECK (file_format IN ('csv', 'xlsx', 'json')),
  delimiter       TEXT,
  sheet_name      TEXT,
  size_bytes      INTEGER NOT NULL,
  expected_rows   INTEGER NOT NULL,
  imported_rows   INTEGER NOT NULL,
  duplicate_rows  INTEGER NOT NULL,
  rejected_rows   INTEGER NOT NULL,
  years_json      TEXT NOT NULL DEFAULT '[]',
  columns_json    TEXT NOT NULL DEFAULT '[]',
  errors_json     TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL CHECK (status IN ('imported', 'imported_with_errors', 'duplicate_upload', 'rejected')),
  stored_path     TEXT,
  duplicate_of    TEXT REFERENCES import_batches(id),
  imported_at     TEXT NOT NULL
);
CREATE INDEX idx_batches_hash ON import_batches(sha256, dataset);
CREATE INDEX idx_batches_dataset ON import_batches(dataset, imported_at);

CREATE TABLE source_records (
  id           TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL REFERENCES import_batches(id),
  table_name   TEXT NOT NULL,
  record_key   TEXT NOT NULL,
  year         INTEGER,
  source_file  TEXT NOT NULL,
  source_row   INTEGER NOT NULL,
  source_line  INTEGER,
  payload_json TEXT NOT NULL,
  row_hash     TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  UNIQUE (table_name, fingerprint)
);
CREATE INDEX idx_records_table_year ON source_records(table_name, year);
CREATE INDEX idx_records_key ON source_records(table_name, record_key);
CREATE INDEX idx_records_batch ON source_records(batch_id);
CREATE TRIGGER source_records_no_update BEFORE UPDATE ON source_records
BEGIN SELECT RAISE(ABORT, 'source_records are immutable'); END;
CREATE TRIGGER source_records_no_delete BEFORE DELETE ON source_records
BEGIN SELECT RAISE(ABORT, 'source_records are immutable'); END;

-- Derived from source_records by the linker; rebuilt after every import.
CREATE TABLE shipments (
  record_id      TEXT PRIMARY KEY REFERENCES source_records(id),
  shipment_id    TEXT NOT NULL,
  year           INTEGER,
  direction      TEXT,
  ref_doc        TEXT,
  ef_id          TEXT,
  mode           TEXT,
  freight_t      REAL,
  distance_km    REAL,
  tkm_recorded   REAL,
  join_status    TEXT NOT NULL,
  erp_record_id  TEXT REFERENCES source_records(id),
  erp_line_count INTEGER NOT NULL DEFAULT 0,
  material_id    TEXT,
  supplier_id    TEXT,
  origin_country TEXT,
  allocation     TEXT NOT NULL DEFAULT 'not_needed',
  route_status   TEXT NOT NULL DEFAULT 'calculated_from_supplied_distance'
);
CREATE INDEX idx_shipments_year ON shipments(year, direction);
CREATE INDEX idx_shipments_ref ON shipments(ref_doc);

CREATE TABLE locations (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('site', 'supplier_pickup', 'port', 'address', 'other')),
  address           TEXT,
  lat               REAL,
  lon               REAL,
  source            TEXT NOT NULL,
  review_status     TEXT NOT NULL DEFAULT 'entered' CHECK (review_status IN ('entered', 'verified', 'rejected')),
  verification_note TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE route_proposals (
  id                      TEXT PRIMARY KEY,
  shipment_record_id      TEXT NOT NULL REFERENCES source_records(id),
  provider                TEXT NOT NULL CHECK (provider IN ('provided_distance', 'manual', 'fixture', 'here')),
  status                  TEXT NOT NULL CHECK (status IN ('proposed', 'verified', 'rejected')),
  is_demo                 INTEGER NOT NULL DEFAULT 0,
  origin_location_id      TEXT REFERENCES locations(id),
  destination_location_id TEXT REFERENCES locations(id),
  vehicle                 TEXT,
  total_km                REAL,
  provider_response_json  TEXT,
  evidence_note           TEXT,
  revision                INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  reviewer_label          TEXT,
  review_reason           TEXT,
  reviewed_at             TEXT
);
CREATE INDEX idx_routes_shipment ON route_proposals(shipment_record_id);

CREATE TABLE route_legs (
  id             TEXT PRIMARY KEY,
  route_id       TEXT NOT NULL REFERENCES route_proposals(id),
  leg_order      INTEGER NOT NULL,
  mode           TEXT NOT NULL,
  distance_km    REAL NOT NULL,
  start_label    TEXT,
  end_label      TEXT,
  start_evidence TEXT,
  end_evidence   TEXT,
  geometry_json  TEXT,
  factor_id      TEXT,
  UNIQUE (route_id, leg_order)
);

CREATE TABLE scans (
  id              TEXT PRIMARY KEY,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  rules_version   TEXT NOT NULL,
  scope_json      TEXT NOT NULL,
  created_count   INTEGER NOT NULL DEFAULT 0,
  updated_count   INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  missing_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dq_issues (
  id                TEXT PRIMARY KEY,
  fingerprint       TEXT NOT NULL UNIQUE,
  rule_id           TEXT NOT NULL,
  rule_version      TEXT NOT NULL,
  issue_type        TEXT NOT NULL,
  category          TEXT NOT NULL,
  table_name        TEXT NOT NULL,
  record_id         TEXT REFERENCES source_records(id),
  record_key        TEXT NOT NULL,
  year              INTEGER,
  field             TEXT,
  observed_value    TEXT,
  candidate_value   TEXT,
  candidate_unit    TEXT,
  action            TEXT NOT NULL CHECK (action IN ('set_value', 'exclude_record', 'add_record', 'acknowledge')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  severity          TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  confidence        REAL NOT NULL,
  impact            TEXT NOT NULL DEFAULT 'normal' CHECK (impact IN ('high', 'normal')),
  explanation       TEXT NOT NULL,
  explanation_en    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
  detection_state   TEXT NOT NULL DEFAULT 'active' CHECK (detection_state IN ('active', 'not_detected_in_last_scan')),
  revision          INTEGER NOT NULL DEFAULT 1,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  last_scan_id      TEXT REFERENCES scans(id),
  decided_at        TEXT
);
CREATE INDEX idx_issues_status ON dq_issues(status, severity);
CREATE INDEX idx_issues_table ON dq_issues(table_name, year);
CREATE INDEX idx_issues_record ON dq_issues(record_id);

CREATE TABLE dq_issue_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id     TEXT NOT NULL REFERENCES dq_issues(id),
  scan_id      TEXT REFERENCES scans(id),
  at           TEXT NOT NULL,
  change       TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_issue_history ON dq_issue_history(issue_id);
CREATE TRIGGER issue_history_no_update BEFORE UPDATE ON dq_issue_history
BEGIN SELECT RAISE(ABORT, 'issue history is append-only'); END;
CREATE TRIGGER issue_history_no_delete BEFORE DELETE ON dq_issue_history
BEGIN SELECT RAISE(ABORT, 'issue history is append-only'); END;

CREATE TABLE corrections (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL UNIQUE REFERENCES dq_issues(id),
  record_id         TEXT REFERENCES source_records(id),
  record_key        TEXT NOT NULL,
  table_name        TEXT NOT NULL,
  field             TEXT,
  action            TEXT NOT NULL CHECK (action IN ('set_value', 'exclude_record', 'add_record', 'acknowledge')),
  original_value    TEXT,
  approved_value    TEXT,
  status            TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
  reviewer_label    TEXT NOT NULL,
  reason            TEXT,
  decided_at        TEXT NOT NULL,
  issue_revision    INTEGER NOT NULL,
  proposed_by       TEXT NOT NULL CHECK (proposed_by IN ('rule', 'ai_investigation')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TRIGGER corrections_no_update BEFORE UPDATE ON corrections
BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;
CREATE TRIGGER corrections_no_delete BEFORE DELETE ON corrections
BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;

CREATE TABLE investigations (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL REFERENCES dq_issues(id),
  mode              TEXT NOT NULL CHECK (mode IN ('gemini', 'stub')),
  model             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('completed', 'degraded', 'failed', 'not_configured')),
  result_json       TEXT,
  tool_calls_json   TEXT NOT NULL DEFAULT '[]',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  error             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  started_at        TEXT NOT NULL,
  finished_at       TEXT
);
CREATE INDEX idx_investigations_issue ON investigations(issue_id);

CREATE TABLE calculation_runs (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  year                INTEGER NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('inventory', 'transport', 'materials')),
  scope2_basis        TEXT NOT NULL CHECK (scope2_basis IN ('location', 'market')),
  status              TEXT NOT NULL CHECK (status IN ('complete', 'complete_with_gaps')),
  trigger             TEXT NOT NULL,
  parent_run_id       TEXT REFERENCES calculation_runs(id),
  method_version      TEXT NOT NULL,
  dataset_hashes_json TEXT NOT NULL,
  correction_ids_json TEXT NOT NULL,
  factor_versions_json TEXT NOT NULL,
  completeness_json   TEXT NOT NULL,
  checks_json         TEXT NOT NULL,
  totals_json         TEXT NOT NULL,
  open_issue_count    INTEGER NOT NULL,
  contribution_count  INTEGER NOT NULL,
  gaps_json           TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_runs_year ON calculation_runs(year, created_at);
CREATE TRIGGER runs_no_update BEFORE UPDATE ON calculation_runs
BEGIN SELECT RAISE(ABORT, 'calculation runs are immutable'); END;
CREATE TRIGGER runs_no_delete BEFORE DELETE ON calculation_runs
BEGIN SELECT RAISE(ABORT, 'calculation runs are immutable'); END;

CREATE TABLE calculation_contributions (
  id                     TEXT PRIMARY KEY,
  run_id                 TEXT NOT NULL REFERENCES calculation_runs(id),
  seq                    INTEGER NOT NULL,
  scope                  TEXT NOT NULL,
  category               TEXT NOT NULL,
  line_item              TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  source_record_ids_json TEXT NOT NULL,
  factor_id              TEXT,
  factor_value           REAL,
  factor_unit            TEXT,
  factor_source          TEXT,
  route_proposal_id      TEXT,
  formula                TEXT NOT NULL,
  inputs_json            TEXT NOT NULL,
  kgco2e                 REAL NOT NULL,
  tco2e                  REAL NOT NULL,
  value_status           TEXT NOT NULL,
  correction_ids_json    TEXT NOT NULL DEFAULT '[]',
  open_issue_ids_json    TEXT NOT NULL DEFAULT '[]',
  in_total               INTEGER NOT NULL CHECK (in_total IN (0, 1)),
  basis                  TEXT
);
CREATE INDEX idx_contrib_run ON calculation_contributions(run_id, scope, category);
CREATE TRIGGER contrib_no_update BEFORE UPDATE ON calculation_contributions
BEGIN SELECT RAISE(ABORT, 'calculation contributions are immutable'); END;
CREATE TRIGGER contrib_no_delete BEFORE DELETE ON calculation_contributions
BEGIN SELECT RAISE(ABORT, 'calculation contributions are immutable'); END;

CREATE TABLE audit_events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  id             TEXT NOT NULL UNIQUE,
  at             TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('reviewer', 'system', 'ai')),
  actor_label    TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT,
  correlation_id TEXT
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;

-- Small document store for workspace content that is edited in the UI
-- (consultant tasks, farm alerts, settings, report drafts, automation runs).
CREATE TABLE documents (
  collection   TEXT NOT NULL,
  id           TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);

-- Read-only convenience views over the newest imported master data.
CREATE VIEW v_emission_factors AS
SELECT r.id AS record_id, json_extract(r.payload_json, '$.ef_id') AS ef_id,
       json_extract(r.payload_json, '$.unit') AS unit,
       CAST(json_extract(r.payload_json, '$.kgco2e_per_unit') AS REAL) AS kgco2e_per_unit,
       json_extract(r.payload_json, '$.version') AS version,
       json_extract(r.payload_json, '$.reference_source') AS reference_source,
       json_extract(r.payload_json, '$.value_status') AS value_status, r.source_file, r.source_row
FROM source_records r WHERE r.table_name = 'emission_factors';

CREATE VIEW v_materials AS
SELECT r.id AS record_id, json_extract(r.payload_json, '$.material_id') AS material_id,
       json_extract(r.payload_json, '$.name_en') AS name_en,
       json_extract(r.payload_json, '$.material_group') AS material_group,
       json_extract(r.payload_json, '$.default_ef_id') AS default_ef_id, r.source_file, r.source_row
FROM source_records r WHERE r.table_name = 'materials';

CREATE VIEW v_suppliers AS
SELECT r.id AS record_id, json_extract(r.payload_json, '$.supplier_id') AS supplier_id,
       json_extract(r.payload_json, '$.country') AS country,
       json_extract(r.payload_json, '$.material_id') AS material_id, r.source_file, r.source_row
FROM source_records r WHERE r.table_name = 'suppliers';
