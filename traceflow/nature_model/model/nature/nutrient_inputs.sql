PRAGMA foreign_keys=ON;
CREATE TABLE input_run (
    run_id TEXT PRIMARY KEY, created_at_utc TEXT NOT NULL, year INTEGER NOT NULL,
    policy_json TEXT NOT NULL, code_hashes_json TEXT NOT NULL,
    source_build_json TEXT NOT NULL, source_files_json TEXT NOT NULL,
    source_reviews_json TEXT NOT NULL, source_proposals_json TEXT NOT NULL
);
CREATE TABLE field_scope (
    parcel_id TEXT PRIMARY KEY, year INTEGER NOT NULL, farm_id TEXT NOT NULL,
    catchment_id TEXT NOT NULL, country TEXT NOT NULL, crop TEXT NOT NULL,
    selection_status TEXT NOT NULL, area_ha REAL NOT NULL CHECK(area_ha>0),
    area_discrepancy INTEGER, quality_findings_json TEXT NOT NULL
);
CREATE TABLE input_value (
    input_id TEXT PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES field_scope,
    variant TEXT NOT NULL, input_name TEXT NOT NULL, unit TEXT NOT NULL,
    original_value REAL, value REAL,
    value_kind TEXT NOT NULL CHECK(value_kind IN ('observed','estimated','derived','unavailable')),
    availability_status TEXT NOT NULL, use_state TEXT NOT NULL,
    reason TEXT NOT NULL, method_version TEXT NOT NULL,
    policy_version TEXT NOT NULL, review_state TEXT NOT NULL,
    uncertainty_kind TEXT NOT NULL, lower_value REAL, upper_value REAL,
    donor_count INTEGER NOT NULL, donor_quality_flagged_count INTEGER NOT NULL,
    depends_on_estimate INTEGER NOT NULL CHECK(depends_on_estimate IN (0,1)),
    UNIQUE(parcel_id,variant,input_name),
    CHECK((value_kind='unavailable')=(value IS NULL)),
    CHECK((lower_value IS NULL AND upper_value IS NULL) OR
          (lower_value IS NOT NULL AND upper_value IS NOT NULL AND lower_value<=upper_value))
);
CREATE TABLE evidence_entity (
    entity_id TEXT PRIMARY KEY, table_name TEXT NOT NULL, key_json TEXT NOT NULL
);
CREATE TABLE evidence_dependency (
    child_entity_id TEXT NOT NULL REFERENCES evidence_entity,
    parent_entity_id TEXT NOT NULL REFERENCES evidence_entity, reason TEXT NOT NULL,
    PRIMARY KEY(child_entity_id,parent_entity_id)
);
CREATE TABLE evidence_source (
    source_id TEXT PRIMARY KEY, relative_path TEXT NOT NULL, sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL, format TEXT NOT NULL
);
CREATE TABLE evidence_record (
    source_record_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES evidence_source,
    locator TEXT NOT NULL, raw_json TEXT NOT NULL
);
CREATE TABLE evidence_link (
    entity_id TEXT NOT NULL REFERENCES evidence_entity,
    source_record_id TEXT NOT NULL REFERENCES evidence_record,
    transformation_id TEXT NOT NULL,
    PRIMARY KEY(entity_id,source_record_id,transformation_id)
);
CREATE TABLE input_evidence (
    input_id TEXT NOT NULL REFERENCES input_value,
    entity_id TEXT NOT NULL REFERENCES evidence_entity,
    role TEXT NOT NULL, PRIMARY KEY(input_id,entity_id,role)
);
CREATE TABLE input_dependency (
    child_input_id TEXT NOT NULL REFERENCES input_value,
    parent_input_id TEXT NOT NULL REFERENCES input_value,
    PRIMARY KEY(child_input_id,parent_input_id)
);
CREATE INDEX input_population ON input_value(variant,input_name,parcel_id);
CREATE TABLE evidence_column_rule (
    table_name TEXT NOT NULL, column_name TEXT NOT NULL,
    source_expression TEXT NOT NULL, rule TEXT NOT NULL,
    PRIMARY KEY(table_name,column_name)
);
CREATE TABLE evidence_transformation (
    transformation_id TEXT PRIMARY KEY, description TEXT NOT NULL
);
CREATE TABLE evidence_method_document (
    relative_path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, document_text TEXT NOT NULL
);
