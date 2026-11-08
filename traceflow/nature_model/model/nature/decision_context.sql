-- Decision context supports nature screening; no nutrient reductions are inferred.
CREATE TABLE site(
    site_id TEXT PRIMARY KEY,name TEXT NOT NULL,country TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,
    activity TEXT NOT NULL,in_group_from INTEGER NOT NULL,in_group_to INTEGER
);
CREATE TABLE emission_factor(
    ef_id TEXT PRIMARY KEY,name TEXT NOT NULL,unit TEXT NOT NULL,kgco2e_per_unit REAL NOT NULL,
    flag_share REAL NOT NULL CHECK(flag_share BETWEEN 0 AND 1),luc_included INTEGER NOT NULL,
    source_type TEXT NOT NULL,reference_source TEXT NOT NULL,geography TEXT NOT NULL,
    version INTEGER NOT NULL,value_status TEXT NOT NULL,gwp_set TEXT NOT NULL
);
CREATE TABLE material_factor_resolution(
    material_id TEXT PRIMARY KEY REFERENCES material,reported_ef_id TEXT NOT NULL,
    factor_id TEXT REFERENCES emission_factor,resolution_status TEXT NOT NULL
);
CREATE TABLE material_site_resolution(
    material_id TEXT PRIMARY KEY REFERENCES material,reported_site_id TEXT NOT NULL,
    site_id TEXT REFERENCES site,resolution_status TEXT NOT NULL
);
CREATE TABLE erp_site_resolution(
    purchase_record_id TEXT PRIMARY KEY REFERENCES erp_purchase,reported_plant TEXT NOT NULL,
    site_id TEXT REFERENCES site,resolution_status TEXT NOT NULL
);

CREATE TABLE reference_source(
    reference_id TEXT PRIMARY KEY,source TEXT NOT NULL,url TEXT NOT NULL,licence TEXT NOT NULL,
    used_for TEXT NOT NULL,verification_status TEXT NOT NULL
);
CREATE TABLE evidence_document(
    document_id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES source_file,
    relative_path TEXT NOT NULL UNIQUE,title TEXT NOT NULL,full_text TEXT NOT NULL,
    verification_status TEXT NOT NULL
);
CREATE TABLE evidence_section(
    section_id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES evidence_document,
    heading TEXT NOT NULL,heading_level INTEGER NOT NULL,start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,section_text TEXT NOT NULL
);
CREATE TABLE method_context(
    method_id TEXT PRIMARY KEY,name TEXT NOT NULL,purpose TEXT NOT NULL,
    implementation_status TEXT NOT NULL,interpretation TEXT NOT NULL,review_status TEXT NOT NULL
);
CREATE TABLE method_evidence(
    evidence_id TEXT PRIMARY KEY,method_id TEXT NOT NULL REFERENCES method_context,
    section_id TEXT REFERENCES evidence_section,reference_id TEXT REFERENCES reference_source,
    evidence_role TEXT NOT NULL,note TEXT NOT NULL,
    CHECK(section_id IS NOT NULL OR reference_id IS NOT NULL)
);
CREATE TABLE model_method_link(
    table_name TEXT NOT NULL,method_id TEXT NOT NULL REFERENCES method_context,usage TEXT NOT NULL,
    PRIMARY KEY(table_name,method_id)
);

CREATE TABLE action_lever(
    lever_id TEXT PRIMARY KEY,name TEXT NOT NULL,scope TEXT NOT NULL,flag INTEGER NOT NULL,
    lever_type TEXT NOT NULL,abatement_tco2e_2030_design REAL NOT NULL,capex_eur REAL NOT NULL,
    opex_delta_eur_per_yr REAL NOT NULL,lifetime_yr INTEGER NOT NULL,earliest_start INTEGER NOT NULL,
    ramp_years INTEGER NOT NULL,confidence TEXT NOT NULL,co_benefits TEXT,trade_offs TEXT,
    indicative_cost_eur_per_tco2e REAL,value_status TEXT NOT NULL
);
CREATE TABLE structural_event(
    event_id TEXT PRIMARY KEY,date TEXT NOT NULL,event TEXT NOT NULL,type TEXT NOT NULL,
    relevance TEXT NOT NULL,source TEXT NOT NULL
);
CREATE TABLE transition_scenario(
    scenario TEXT NOT NULL,ngfs_category TEXT NOT NULL,narrative TEXT NOT NULL,year INTEGER NOT NULL,
    physical_pathway_proxy TEXT NOT NULL,carbon_price_eur_t REAL NOT NULL,eu_ets2_fuel_price_eur_t REAL NOT NULL,
    electricity_price_eur_mwh REAL NOT NULL,n_fertiliser_price_index REAL NOT NULL,diesel_price_index REAL NOT NULL,
    plant_based_demand_index REAL NOT NULL,frozen_veg_import_premium_pct REAL NOT NULL,value_status TEXT NOT NULL,
    PRIMARY KEY(scenario,year)
);
CREATE TABLE contract_price(
    year INTEGER NOT NULL,item TEXT NOT NULL,contract_price_eur_t REAL NOT NULL,
    replacement_import_premium_frac REAL NOT NULL,note TEXT NOT NULL,PRIMARY KEY(year,item)
);
CREATE TABLE price_crop_mapping(
    item TEXT PRIMARY KEY,crop TEXT NOT NULL,country TEXT NOT NULL,interpretation TEXT NOT NULL
);
CREATE TABLE published_inventory(
    year INTEGER PRIMARY KEY,scope1 REAL NOT NULL,scope2_market REAL NOT NULL,scope3 REAL NOT NULL,
    scope3_restated REAL,note TEXT
);
CREATE TABLE draft_report_line(
    year INTEGER NOT NULL,line TEXT NOT NULL,tco2e REAL NOT NULL,status TEXT NOT NULL,PRIMARY KEY(year,line)
);
CREATE TABLE nature_action_rule(
    rule_id TEXT PRIMARY KEY,version TEXT NOT NULL,lever_id TEXT NOT NULL UNIQUE REFERENCES action_lever,
    predicate TEXT NOT NULL,description TEXT NOT NULL,prerequisites TEXT NOT NULL,efficacy_status TEXT NOT NULL
);
CREATE TABLE nature_action_candidate(
    parcel_id TEXT NOT NULL,year INTEGER NOT NULL,lever_id TEXT NOT NULL REFERENCES action_lever,
    rule_id TEXT NOT NULL REFERENCES nature_action_rule,rule_version TEXT NOT NULL,
    reason TEXT NOT NULL,review_status TEXT NOT NULL,
    PRIMARY KEY(parcel_id,year,lever_id),FOREIGN KEY(parcel_id,year) REFERENCES parcel_crop_year
);
CREATE INDEX action_candidate_year_lever ON nature_action_candidate(year,lever_id);
