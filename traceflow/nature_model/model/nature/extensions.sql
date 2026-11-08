-- Investigation rules are versioned independently of findings or human reviews.
CREATE TABLE quality_rule (
    rule_id TEXT PRIMARY KEY, version TEXT NOT NULL, issue_type TEXT NOT NULL,
    severity TEXT NOT NULL, description TEXT NOT NULL, parameters_json TEXT NOT NULL
);
CREATE TABLE quality_finding (
    finding_id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES quality_rule,
    rule_version TEXT NOT NULL, entity_id TEXT REFERENCES entity_record,
    source_record_id TEXT REFERENCES source_record, expected_key_json TEXT,
    year INTEGER, field_name TEXT, observed_json TEXT NOT NULL,
    expected_json TEXT NOT NULL, explanation TEXT NOT NULL
);
CREATE TABLE quality_evidence (
    finding_id TEXT NOT NULL REFERENCES quality_finding,
    source_record_id TEXT REFERENCES source_record, entity_id TEXT REFERENCES entity_record,
    role TEXT NOT NULL, CHECK(source_record_id IS NOT NULL OR entity_id IS NOT NULL)
);
CREATE TABLE quality_scope (
    finding_id TEXT NOT NULL REFERENCES quality_finding,
    parcel_id TEXT NOT NULL REFERENCES parcel, year INTEGER NOT NULL,
    catchment_id TEXT NOT NULL REFERENCES catchment,
    PRIMARY KEY(finding_id, parcel_id, year)
);
CREATE TABLE quality_review (
    review_id INTEGER PRIMARY KEY, finding_id TEXT NOT NULL REFERENCES quality_finding,
    status TEXT NOT NULL CHECK(status IN ('confirmed','dismissed','needs_investigation')),
    reviewer TEXT NOT NULL CHECK(length(trim(reviewer))>0), reviewed_at_utc TEXT NOT NULL,
    note TEXT NOT NULL CHECK(length(trim(note))>0)
);
CREATE TABLE correction_proposal (
    proposal_id INTEGER PRIMARY KEY, finding_id TEXT NOT NULL REFERENCES quality_finding,
    field_name TEXT NOT NULL, original_value_json TEXT NOT NULL, proposed_value_json TEXT NOT NULL,
    reason TEXT NOT NULL, proposed_by TEXT NOT NULL, proposed_at_utc TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
    reviewed_by TEXT, reviewed_at_utc TEXT,
    CHECK(status='proposed' OR (reviewed_by IS NOT NULL AND reviewed_at_utc IS NOT NULL))
);
CREATE TABLE quarantine_record (
    source_record_id TEXT NOT NULL REFERENCES source_record, target_table TEXT NOT NULL,
    reason TEXT NOT NULL, PRIMARY KEY(source_record_id, target_table)
);
CREATE INDEX quality_scope_catchment ON quality_scope(catchment_id, year);
CREATE INDEX quality_scope_field_year ON quality_scope(parcel_id, year);
CREATE INDEX quality_evidence_entity ON quality_evidence(entity_id);
CREATE INDEX parcel_observation_idx ON parcel_crop_year(observation_id);
CREATE VIEW quality_finding_context AS
SELECT f.*, r.issue_type, r.severity,
       COALESCE((SELECT status FROM quality_review v WHERE v.finding_id=f.finding_id
                 ORDER BY review_id DESC LIMIT 1),'unreviewed') AS review_status
FROM quality_finding f JOIN quality_rule r USING(rule_id);

CREATE TABLE query_definition (
    query_id TEXT PRIMARY KEY, description TEXT NOT NULL, grain TEXT NOT NULL,
    parameters_json TEXT NOT NULL, sql_text TEXT NOT NULL, lineage_sql_text TEXT NOT NULL
);
CREATE TABLE query_review_snapshot (
    query_run_id TEXT NOT NULL REFERENCES query_run,review_id INTEGER NOT NULL,
    finding_id TEXT NOT NULL,status TEXT NOT NULL,reviewer TEXT NOT NULL,
    reviewed_at_utc TEXT NOT NULL,note TEXT NOT NULL,
    PRIMARY KEY(query_run_id,review_id)
);

CREATE TABLE climate_grid_cell (
    cell_id TEXT PRIMARY KEY, region TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
    continentality REAL NOT NULL, elevation_m REAL NOT NULL
);
CREATE TABLE weather_monthly (
    cell_id TEXT NOT NULL REFERENCES climate_grid_cell, scenario TEXT NOT NULL,
    year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    tmean_c REAL NOT NULL, tmax_c_max REAL NOT NULL, precip_mm REAL NOT NULL,
    pet_mm REAL NOT NULL, hot_days_tmax_ge_27 INTEGER NOT NULL,
    PRIMARY KEY(cell_id,scenario,year,month)
);
CREATE TABLE climate_change_signal (
    scenario TEXT NOT NULL, period TEXT NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    delta_tmean_c REAL NOT NULL, precip_factor REAL NOT NULL, wetday_factor REAL NOT NULL,
    PRIMARY KEY(scenario,period,month)
);
CREATE TABLE parcel_climate_mapping (
    parcel_id TEXT PRIMARY KEY REFERENCES parcel, cell_id TEXT NOT NULL REFERENCES climate_grid_cell,
    distance_km REAL NOT NULL, method TEXT NOT NULL, mapping_status TEXT NOT NULL
);
CREATE TABLE weather_annual (
    cell_id TEXT NOT NULL REFERENCES climate_grid_cell, scenario TEXT NOT NULL,year INTEGER NOT NULL,
    months_present INTEGER NOT NULL, apr_sep_months_present INTEGER NOT NULL,
    annual_precip_mm REAL,annual_pet_mm REAL,apr_sep_precip_mm REAL,apr_sep_pet_mm REAL,
    PRIMARY KEY(cell_id,scenario,year)
);
CREATE INDEX weather_year_scenario ON weather_monthly(year,scenario);
CREATE VIEW field_climate_context AS
SELECT f.*,m.cell_id,m.distance_km AS climate_grid_distance_km,m.mapping_status,
       a.scenario,a.months_present,a.apr_sep_months_present,a.annual_precip_mm,a.annual_pet_mm,
       a.apr_sep_precip_mm,a.apr_sep_pet_mm
FROM field_context f LEFT JOIN parcel_climate_mapping m USING(parcel_id)
LEFT JOIN weather_annual a ON a.cell_id=m.cell_id AND a.year=f.year;

CREATE TABLE material (
    material_id TEXT PRIMARY KEY,erp_name TEXT NOT NULL,name_en TEXT NOT NULL,material_group TEXT NOT NULL,
    base_uom TEXT NOT NULL,default_ef_id TEXT NOT NULL,receiving_site TEXT NOT NULL,
    origin_countries TEXT NOT NULL,eudr_commodity INTEGER NOT NULL,sbtn_high_impact_commodity INTEGER NOT NULL
);
CREATE TABLE supplier (
    supplier_id TEXT PRIMARY KEY,supplier_name TEXT NOT NULL,supplier_type TEXT NOT NULL,country TEXT NOT NULL,
    material_id TEXT NOT NULL,sbti_status TEXT NOT NULL,provides_pcf INTEGER NOT NULL,cdp_score TEXT NOT NULL
);
CREATE TABLE fx_reference_assumption (
    currency TEXT PRIMARY KEY,units_per_eur REAL NOT NULL CHECK(units_per_eur>0),
    source_reference TEXT NOT NULL,interpretation TEXT NOT NULL
);
CREATE TABLE material_crop_mapping (
    material_id TEXT PRIMARY KEY REFERENCES material,crop TEXT NOT NULL,source_reference TEXT NOT NULL
);
CREATE TABLE erp_purchase (
    purchase_record_id TEXT PRIMARY KEY,doc_no TEXT NOT NULL,line_no INTEGER NOT NULL,
    posting_date TEXT NOT NULL,year INTEGER NOT NULL,company_code TEXT NOT NULL,plant TEXT NOT NULL,
    material_id TEXT NOT NULL,material_text TEXT NOT NULL,supplier_id TEXT NOT NULL,
    quantity REAL NOT NULL,uom TEXT NOT NULL,net_amount REAL NOT NULL,currency TEXT NOT NULL,
    origin_country TEXT NOT NULL,lot_id TEXT,movement_type INTEGER NOT NULL,reference_doc TEXT,wbs_element TEXT,
    resolved_material_id TEXT REFERENCES material,resolved_supplier_id TEXT REFERENCES supplier,
    farm_id TEXT REFERENCES farm,quantity_kg REAL,amount_eur_reference_rate REAL,
    fx_currency TEXT REFERENCES fx_reference_assumption
);
CREATE INDEX erp_business_key ON erp_purchase(doc_no,line_no);
CREATE INDEX erp_farm_material_year ON erp_purchase(farm_id,material_id,year);
CREATE VIEW farm_crop_purchases AS
SELECT e.farm_id,m.crop,e.year,COUNT(*) AS purchase_record_count,
       SUM(e.quantity_kg) AS reported_net_quantity_kg,
       SUM(e.quantity_kg IS NULL) AS records_without_mass_conversion
FROM erp_purchase e JOIN material_crop_mapping m ON m.material_id=e.resolved_material_id
WHERE e.farm_id IS NOT NULL GROUP BY e.farm_id,m.crop,e.year;
CREATE VIEW field_sourcing_context AS
SELECT f.*,CASE WHEN p.purchase_record_count IS NULL THEN 'no_matching_purchase'
              WHEN p.reported_net_quantity_kg>0 THEN 'positive_reported_net_purchase'
              ELSE 'purchase_present_without_positive_net_mass' END AS reported_purchase_support,
       COALESCE(p.purchase_record_count,0) AS matching_purchase_record_count
FROM field_context f LEFT JOIN farm_crop_purchases p
 ON p.farm_id=f.farm_id AND p.crop=f.crop AND p.year=f.year;
