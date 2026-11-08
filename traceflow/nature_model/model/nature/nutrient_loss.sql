PRAGMA foreign_keys=ON;
CREATE TABLE loss_run (
    loss_run_id TEXT PRIMARY KEY, created_at_utc TEXT NOT NULL,
    year INTEGER NOT NULL, catchment_id TEXT NOT NULL,
    model_json TEXT NOT NULL, code_hashes_json TEXT NOT NULL,
    input_artifact_sha256 TEXT NOT NULL, input_run_id TEXT NOT NULL REFERENCES input_run,
    source_build_json TEXT NOT NULL, scientific_status TEXT NOT NULL
);
CREATE TABLE loss_driver (
    parcel_id TEXT PRIMARY KEY REFERENCES field_scope,
    year INTEGER NOT NULL, weather_scenario TEXT NOT NULL,
    drivers_json TEXT NOT NULL
);
CREATE TABLE loss_driver_evidence (
    parcel_id TEXT NOT NULL REFERENCES loss_driver,
    entity_id TEXT NOT NULL REFERENCES evidence_entity, role TEXT NOT NULL,
    PRIMARY KEY(parcel_id,entity_id,role)
);
CREATE TABLE field_loss (
    loss_id TEXT PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES loss_driver,
    year INTEGER NOT NULL, nutrient TEXT NOT NULL CHECK(nutrient IN ('P','N')),
    input_variant TEXT NOT NULL, input_point TEXT NOT NULL, stress_case TEXT NOT NULL,
    model_version TEXT NOT NULL, weather_scenario TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('estimated_unvalidated','unavailable')),
    reason TEXT NOT NULL, area_ha REAL NOT NULL,
    field_loss_kg_ha_year REAL, field_loss_kg REAL,
    delivery_fraction REAL, retention_fraction REAL,
    pre_retention_kg REAL, delivered_kg REAL,
    factors_json TEXT NOT NULL,
    UNIQUE(parcel_id,nutrient,input_variant,input_point,stress_case),
    CHECK(delivery_fraction IS NULL OR delivery_fraction BETWEEN 0 AND 1),
    CHECK(retention_fraction IS NULL OR retention_fraction BETWEEN 0 AND 1),
    CHECK((status='unavailable')=(delivered_kg IS NULL))
);
CREATE TABLE loss_input (
    loss_id TEXT NOT NULL REFERENCES field_loss,
    input_id TEXT NOT NULL REFERENCES input_value, role TEXT NOT NULL,
    PRIMARY KEY(loss_id,input_id)
);
CREATE INDEX loss_aggregation ON field_loss(nutrient,input_variant,input_point,stress_case);
