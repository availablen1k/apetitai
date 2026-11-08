PRAGMA foreign_keys = ON;

CREATE TABLE build_run (
    build_id TEXT PRIMARY KEY, built_at_utc TEXT NOT NULL,
    code_hashes_json TEXT NOT NULL, parameters_json TEXT NOT NULL
);
CREATE TABLE source_file (
    source_id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, format TEXT NOT NULL
);
CREATE TABLE source_record (
    source_record_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source_file,
    locator TEXT NOT NULL, raw_json TEXT NOT NULL,
    UNIQUE(source_id, locator)
);
CREATE TABLE transformation (
    transformation_id TEXT PRIMARY KEY, description TEXT NOT NULL
);
CREATE TABLE column_lineage (
    table_name TEXT NOT NULL, column_name TEXT NOT NULL,
    source_expression TEXT NOT NULL, rule TEXT NOT NULL,
    PRIMARY KEY(table_name, column_name)
);
CREATE TABLE entity_record (
    entity_id TEXT PRIMARY KEY, table_name TEXT NOT NULL,
    key_json TEXT NOT NULL, UNIQUE(table_name, key_json)
);
CREATE TABLE record_source (
    entity_id TEXT NOT NULL REFERENCES entity_record,
    source_record_id TEXT NOT NULL REFERENCES source_record,
    transformation_id TEXT NOT NULL REFERENCES transformation,
    PRIMARY KEY(entity_id, source_record_id, transformation_id)
);
CREATE TABLE record_dependency (
    child_entity_id TEXT NOT NULL REFERENCES entity_record,
    parent_entity_id TEXT NOT NULL REFERENCES entity_record,
    reason TEXT NOT NULL,
    PRIMARY KEY(child_entity_id, parent_entity_id)
);

CREATE TABLE farm (
    farm_id TEXT PRIMARY KEY, country TEXT NOT NULL, region TEXT NOT NULL,
    segment TEXT NOT NULL, contract_crops TEXT,
    lat REAL,lon REAL,organic_certified INTEGER CHECK(organic_certified IN (0,1)),
    livestock INTEGER CHECK(livestock IN (0,1)),joined_year INTEGER
);
CREATE TABLE catchment (
    catchment_id TEXT PRIMARY KEY, region TEXT NOT NULL,
    receiving_water_type TEXT NOT NULL, ecological_status_class TEXT NOT NULL,
    nutrient_retention_frac_estimate REAL NOT NULL CHECK(nutrient_retention_frac_estimate BETWEEN 0 AND 1),
    catchment_area_km2 REAL NOT NULL CHECK(catchment_area_km2 > 0),
    field_area_total_ha REAL NOT NULL CHECK(field_area_total_ha >= 0),
    p_sensitivity REAL NOT NULL CHECK(p_sensitivity > 0),
    monitoring_station INTEGER NOT NULL CHECK(monitoring_station IN (0,1))
);
CREATE TABLE parcel (
    parcel_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farm,
    catchment_id TEXT NOT NULL REFERENCES catchment,
    lat REAL NOT NULL, lon REAL NOT NULL, area_ha REAL NOT NULL CHECK(area_ha > 0),
    soil_class_soilmap TEXT NOT NULL, clay_pct_soilmap REAL NOT NULL,
    slope_pct REAL NOT NULL, dist_to_water_m REAL NOT NULL,
    drainage TEXT NOT NULL, p_test_mgl_latest REAL,
    buffer_strip INTEGER NOT NULL CHECK(buffer_strip IN (0,1))
);
CREATE TABLE farm_crop_observation (
    observation_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farm,
    crop TEXT NOT NULL, year INTEGER NOT NULL, source_kind TEXT NOT NULL,
    reported_area_ha REAL, delivered_t REAL,
    soil_type_reported TEXT, n_mineral_kg_ha REAL, n_manure_kg_ha REAL,
    n_applied_kg_ha REAL, p_kg_ha REAL, fertiliser_product TEXT,
    diesel_l_ha REAL, lime_t_ha REAL, sprays REAL,
    irrigated INTEGER CHECK(irrigated IN (0,1)), catch_crop_share REAL, yield_t_ha REAL,
    UNIQUE(farm_id, crop, year)
);
CREATE TABLE parcel_crop_year (
    parcel_id TEXT NOT NULL REFERENCES parcel, year INTEGER NOT NULL,
    crop TEXT NOT NULL, crop_status TEXT NOT NULL,
    catch_crop INTEGER NOT NULL CHECK(catch_crop IN (0,1)),
    is_contract_crop_provisional INTEGER NOT NULL CHECK(is_contract_crop_provisional IN (0,1)),
    observation_id TEXT REFERENCES farm_crop_observation,
    area_difference_over_5pct INTEGER CHECK(area_difference_over_5pct IN (0,1)),
    management_review_status TEXT NOT NULL,
    PRIMARY KEY(parcel_id, year)
);
CREATE TABLE catchment_monitoring (
    catchment_id TEXT NOT NULL REFERENCES catchment, year INTEGER NOT NULL,
    total_p_load_kg REAL NOT NULL CHECK(total_p_load_kg >= 0),
    total_n_load_kg REAL NOT NULL CHECK(total_n_load_kg >= 0), method TEXT NOT NULL,
    PRIMARY KEY(catchment_id, year)
);
CREATE TABLE current_calculator_footprint (
    farm_id TEXT NOT NULL REFERENCES farm, crop TEXT NOT NULL, year INTEGER NOT NULL,
    observation_id TEXT NOT NULL REFERENCES farm_crop_observation,
    carbon_footprint_kgco2e_per_kg REAL NOT NULL,
    calculator_note TEXT NOT NULL,
    PRIMARY KEY(farm_id, crop, year)
);
CREATE TABLE parcel_geometry (
    parcel_id TEXT PRIMARY KEY REFERENCES parcel, crs TEXT NOT NULL, geometry_json TEXT NOT NULL
);
CREATE TABLE catchment_geometry (
    catchment_id TEXT PRIMARY KEY REFERENCES catchment, crs TEXT NOT NULL, geometry_json TEXT NOT NULL
);
CREATE TABLE origin_nature_indicator (
    origin_country TEXT NOT NULL, commodity TEXT NOT NULL,
    baseline_water_stress_cat_indicative INTEGER NOT NULL,
    deforestation_conversion_risk_indicative TEXT NOT NULL,
    biodiversity_sensitivity_indicative TEXT NOT NULL,
    freshwater_nutrient_status_indicative TEXT NOT NULL,
    water_stress_scale TEXT NOT NULL, source_note TEXT NOT NULL,
    PRIMARY KEY(origin_country, commodity)
);

CREATE INDEX parcel_catchment_idx ON parcel(catchment_id);
CREATE INDEX parcel_farm_idx ON parcel(farm_id);
CREATE INDEX observation_join_idx ON farm_crop_observation(farm_id, crop, year);
CREATE INDEX crop_year_filter_idx ON parcel_crop_year(year, is_contract_crop_provisional);
CREATE INDEX dependency_parent_idx ON record_dependency(parent_entity_id);
CREATE INDEX record_source_raw_idx ON record_source(source_record_id);

CREATE VIEW field_context AS
SELECT y.*, p.farm_id, p.catchment_id, p.area_ha, p.soil_class_soilmap,
       p.p_test_mgl_latest, p.buffer_strip, f.country, f.region,
       f.organic_certified,f.livestock,f.joined_year,
       o.p_kg_ha AS reported_p_kg_ha, o.n_mineral_kg_ha AS reported_n_mineral_kg_ha,
       o.n_manure_kg_ha AS reported_n_manure_kg_ha,
       o.n_applied_kg_ha AS reported_n_applied_kg_ha,
       CASE WHEN f.contract_crops IS NULL THEN 'unknown_contract_list'
            WHEN y.is_contract_crop_provisional = 1 THEN 'selected'
            ELSE 'not_selected_by_registry' END AS contract_selection_status
FROM parcel_crop_year y
JOIN parcel p ON p.parcel_id = y.parcel_id
JOIN farm f ON f.farm_id = p.farm_id
LEFT JOIN farm_crop_observation o ON o.observation_id = y.observation_id;

-- Compatibility view; the base model and general field_context retain all years.
CREATE VIEW field_context_2025 AS SELECT * FROM field_context WHERE year = 2025;

-- Coverage classification v0.1.0; not scientific approval or model eligibility.
-- Preserve reported values and separate schema omissions from absent reports.
CREATE VIEW nutrient_input_context AS
WITH inputs(input_name,unit) AS (VALUES
    ('p_kg_ha','kg P/ha'), ('n_mineral_kg_ha','kg N/ha'),
    ('n_manure_kg_ha','kg N/ha'), ('n_applied_kg_ha','kg N/ha'),
    ('yield_t_ha','t harvested/ha'), ('p_test_mgl_latest','mg/L')),
values_by_field AS (
    SELECT f.*, i.input_name,i.unit,
           CASE i.input_name
               WHEN 'p_kg_ha' THEN o.p_kg_ha
               WHEN 'n_mineral_kg_ha' THEN o.n_mineral_kg_ha
               WHEN 'n_manure_kg_ha' THEN o.n_manure_kg_ha
               WHEN 'n_applied_kg_ha' THEN o.n_applied_kg_ha
               WHEN 'yield_t_ha' THEN o.yield_t_ha
               WHEN 'p_test_mgl_latest' THEN f.p_test_mgl_latest END AS input_value,
           CASE WHEN i.input_name='p_test_mgl_latest' THEN 'static_parcel'
                ELSE 'farm_crop_year_report' END AS input_origin,
           CASE WHEN i.input_name='p_test_mgl_latest' THEN 1
                WHEN f.country='FI' AND i.input_name!='n_applied_kg_ha' THEN 1
                WHEN f.country='SE' AND i.input_name='n_applied_kg_ha' THEN 1
                ELSE 0 END AS collected_by_schema
    FROM field_context f CROSS JOIN inputs i
    LEFT JOIN farm_crop_observation o ON o.observation_id=f.observation_id
)
SELECT v.*,
       '0.1.0' AS coverage_policy_version,'draft_unreviewed' AS policy_review_state,
       CASE WHEN input_origin!='static_parcel' AND crop_status='planned' THEN 'not_observed_plan'
            WHEN collected_by_schema=0 THEN 'not_collected_by_schema'
            WHEN input_origin!='static_parcel' AND observation_id IS NULL THEN 'missing_report'
            WHEN input_value IS NULL THEN 'missing_value'
            WHEN input_value=0 THEN 'reported_zero'
            WHEN input_value<0 THEN 'reported_negative'
            ELSE 'reported_positive' END AS availability_status
FROM values_by_field v;

CREATE TABLE query_run (
    query_run_id TEXT PRIMARY KEY, query_id TEXT NOT NULL,
    executed_at_utc TEXT NOT NULL, parameters_json TEXT NOT NULL,
    sql_text TEXT NOT NULL, sql_sha256 TEXT NOT NULL,
    lineage_sql_text TEXT NOT NULL, lineage_sql_sha256 TEXT NOT NULL,
    description TEXT NOT NULL
);
CREATE TABLE query_result (
    entity_id TEXT PRIMARY KEY REFERENCES entity_record,
    query_run_id TEXT NOT NULL REFERENCES query_run,
    result_key TEXT NOT NULL, values_json TEXT NOT NULL,
    UNIQUE(query_run_id, result_key)
);
